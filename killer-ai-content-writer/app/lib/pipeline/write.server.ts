import writerPrompt from "./prompts/writer.md?raw";
import auditorPrompt from "./prompts/auditor.md?raw";
import fixerPrompt from "./prompts/fixer.md?raw";
import guideWriterPrompt from "./prompts/guide-writer.md?raw";
import { DEFAULT_SETTINGS, settingsContext, voiceGuide, type AppSettings } from "../settings";
import { chatJson } from "./llm.server";
import {
  cleanStructure,
  closingSection,
  findRepeats,
  genericClosing,
  removeRepeats,
  removeSections,
  repairLink,
  runChecks,
  splitSentences,
  verifyLabels,
} from "./checks";
import { addInternalLinks, addLinkOnPhrase, type LinkTargets } from "./links";
import { sameKeyword } from "../keywords";
import type { Angle, Article, ArticleResult, AuditProblem, AuditReport, MerchantFacts, ProductFacts } from "./types";

const LINKS = /\[[^\]]+\]\(\{\{PRODUCT_URL(?::[a-z0-9_-]+)?\}\}\)/g;
const mask = (n: number) => `⟦PRODUCT_LINK_${n}⟧`;
/** Hides product links from the fixer so it can't change them, and puts them back afterwards. */
const maskLinks = (md: string) => {
  const links: string[] = [];
  const text = md.replace(LINKS, (m) => mask(links.push(m) - 1));
  return { text, links };
};
const unmaskLinks = (md: string, links: string[]) => links.reduce((t, l, i) => t.replace(mask(i), l), md);

type Progress = (stage: string) => Promise<void> | void;

export async function writeArticle(
  product: ProductFacts,
  angle: Angle,
  merchant: MerchantFacts,
  progress: Progress = () => {},
  settings: AppSettings = DEFAULT_SETTINGS,
  guide?: ProductFacts[],
  links?: LinkTargets,
): Promise<ArticleResult> {
  let tokens = 0;
  const call = async <T>(system: string, user: string, temperature: number): Promise<T> => {
    const r = await chatJson<T>(system, user, { temperature });
    tokens += r.tokens;
    return r.json;
  };

  const facts = `PRODUCT DATA\n${JSON.stringify(guide ?? product, null, 2)}\n\nMERCHANT FACTS\n${JSON.stringify(
    merchant.known,
    null,
    2,
  )}\n\nUNKNOWN TO THE MERCHANT (do not cover, estimate or hint at these)\n${JSON.stringify(merchant.unknown)}`;
  const gaps = [...(angle.needs_info?.filter(Boolean) ?? []), ...merchant.unknown];

  await progress("Writing the article");
  const article = await call<Article>(
    guide ? guideWriterPrompt : writerPrompt,
    `VOICE GUIDE\n${voiceGuide(settings)}\n\n${settingsContext(settings, "content")}\n\n${facts}\n\nUNAVAILABLE FACTS\n${JSON.stringify(gaps)}\n\nCHOSEN ANGLE\n${JSON.stringify(
      angle,
    )}\n\nSOURCES PROVIDED\nnone`,
    0.6,
  );
  if (guide) article.guide = true;
  article.faq = Array.isArray(article.faq) ? article.faq : [];
  article.tldr = article.tldr ?? "";
  article.body_markdown = article.body_markdown ?? "";

  const audit = async (art: Article): Promise<AuditReport> => {
    const sentences = splitSentences(art);
    const listing = (ss: typeof sentences) => ss.map((x) => `${x.id} [where=${x.where}]: ${x.text}`).join("\n");
    type Raw = Parameters<typeof verifyLabels>[1];
    let raw = await call<Raw>(auditorPrompt, `${facts}\n\nSENTENCES\n${listing(sentences)}`, 0);
    let res = verifyLabels(sentences, raw, facts, merchant.known);
    if (res.missing.length) {
      const rest = sentences.filter((x) => res.missing.includes(x.id));
      const raw2 = await call<Raw>(auditorPrompt, `${facts}\n\nSENTENCES\n${listing(rest)}`, 0);
      raw = { labels: [...(raw.labels || []), ...(raw2.labels || [])], leaks: raw.leaks || [] };
      res = verifyLabels(sentences, raw, facts, merchant.known);
    }
    for (const id of res.missing) {
      res.unsupported.push({
        text: sentences.find((x) => x.id === id)!.text,
        problem: "fact-checker did not review this sentence",
      });
    }
    return res;
  };

  const apply = (art: Article, edits: { find?: string; replace?: string }[]) => {
    const masked = maskLinks(art.body_markdown);
    art.body_markdown = masked.text;
    const swap = (s: string) => {
      for (const e of edits)
        if (e.find && !e.find.includes("{{PRODUCT_URL") && s.includes(e.find)) s = s.replace(e.find, e.replace ?? "");
      return s;
    };
    art.tldr = swap(art.tldr);
    if (art.excerpt) art.excerpt = swap(art.excerpt);
    if (art.email_body) art.email_body = swap(art.email_body);
    if (art.social_post) art.social_post = swap(art.social_post);
    art.body_markdown = swap(art.body_markdown)
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/ {2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n");
    art.body_markdown = cleanStructure(removeRepeats(art.body_markdown));
    art.body_markdown = unmaskLinks(art.body_markdown, masked.links);
    art.faq = art.faq.map((f) => ({ q: swap(f.q), a: swap(f.a) })).filter((f) => f.a.trim());
  };

  article.body_markdown = cleanStructure(removeRepeats(article.body_markdown));

  // Short of the 500-word target: one expansion pass that only develops facts already supplied.
  if (runChecks(article).words < 500) {
    await progress("Developing the article further");
    const more = await call<Partial<Article>>(
      "You expand an article that is slightly under 500 words in its tldr, body and FAQ. Return the SAME JSON object with the same keys, rewritten to reach at least 540 words in total across tldr, body_markdown and faq. Develop facts already present in PRODUCT DATA and MERCHANT FACTS more fully: add a short section, explain how a supplied fact helps the reader, or give fuller FAQ answers. NEVER pad, repeat yourself, or add any claim, number, benefit or suitability statement that is not in the facts. Do NOT add a section or FAQ whose heading or question the facts cannot answer with a specific fact; if you cannot reach 540 words without padding, return the article unchanged. Anything under UNKNOWN TO THE MERCHANT must not appear anywhere, including email_body and social_post. Keep every {{PRODUCT_URL...}} link and {{ARTICLE_URL}} exactly as written, keep the voice, and keep the email and social copy to supplied facts only.",
      `VOICE GUIDE\n${voiceGuide(settings)}\n\n${facts}\n\nARTICLE\n${JSON.stringify(article)}`,
      0.4,
    );
    if (more && typeof more.body_markdown === "string" && more.body_markdown.length > article.body_markdown.length) {
      const keep = { ...article };
      Object.assign(article, more, { guide: keep.guide });
      article.faq = Array.isArray(article.faq) ? article.faq : keep.faq;
      article.tldr = article.tldr ?? keep.tldr;
      article.body_markdown = cleanStructure(removeRepeats(article.body_markdown));
      if (runChecks(article).words < runChecks(keep).words) Object.assign(article, keep);
    }
  }

  // Padding check: drop sections and FAQ items that dodge their own question or only repeat what was already said.
  await progress("Trimming anything that doesn't earn its place");
  try {
    const review = await call<{ remove_sections?: { heading?: string }[]; remove_faq?: { q?: string }[] }>(
      'You review a draft article for padding. Return ONLY JSON {"remove_sections":[{"heading":"","reason":""}],"remove_faq":[{"q":"","reason":""}]}. Remove a section or FAQ item ONLY when (1) its heading or question is not actually answered by the text beneath it (the text is a vague sentence that sidesteps the question, for example asked whether something is needed it answers with something unrelated), or (2) everything it says already appears earlier in the article in the same or nearly the same words. Do NOT remove one whose answer states a clear fact, even a short one, or a yes/no answer that follows from a fact (for example "Can it go in a tumble dryer?" answered "No, it should be hang dried"). Copy headings and questions exactly as written. If nothing needs removing return empty arrays.',
      `ARTICLE BODY\n${article.body_markdown}\n\nFAQ\n${JSON.stringify(article.faq)}`,
      0,
    );
    const drop = (review?.remove_faq ?? []).map((x) => (x.q ?? "").trim().toLowerCase()).filter(Boolean);
    const trimmedFaq = article.faq.filter((f) => !drop.includes(f.q.trim().toLowerCase()));
    if (trimmedFaq.length >= 1 || !article.faq.length) article.faq = trimmedFaq;
    const heads = (review?.remove_sections ?? []).map((x) => x.heading ?? "").filter(Boolean);
    if (heads.length) {
      const total = (article.body_markdown.match(/^## /gm) || []).length;
      const cut = removeSections(article.body_markdown, heads.slice(0, Math.max(1, Math.floor(total / 3))));
      if (cut.removed.length) article.body_markdown = cleanStructure(cut.md);
    }
  } catch (e) {
    console.error("Padding review failed", e);
  }

  // A vague closing ("view it on our store to see if it fits your needs") gets one targeted rewrite from the facts.
  if (genericClosing(article.body_markdown)) {
    await progress("Sharpening the closing call to action");
    const c = closingSection(article.body_markdown);
    const tokensIn = (t: string) => (t.match(/\{\{PRODUCT_URL(?::[a-z0-9_-]+)?\}\}/g) || []).sort().join("|");
    if (c) {
      const rewrite = await call<{ heading?: string; body_markdown?: string }>(
        "You rewrite ONLY the closing section of a blog article so its call to action is specific and useful. Return JSON {\"heading\":\"\",\"body_markdown\":\"\"}. Rules: the heading is specific and benefit-led and names the decision the reader is making (never 'Conclusion', 'Final thoughts', 'A final note', 'Summary', 'Wrapping up' or 'Making your choice'). The body is 2 to 4 sentences: sentence one answers the question the article asked using one or two concrete facts from PRODUCT DATA or MERCHANT FACTS (a material, size, capacity or care instruction); if a sentence about who it suits is supported, add it; the last sentence is a direct next step that names the product and keeps its existing {{PRODUCT_URL...}} link on the product's name, ending on the most decisive supported fact. NEVER use vague closers such as 'to see if it fits your needs', 'view it on our store', 'check it out', 'take a look', 'learn more', 'explore our range'. Use only supported facts: no pressure, urgency, discounts, promises or new claims; nothing from UNKNOWN TO THE MERCHANT. Keep every {{PRODUCT_URL...}} token that is in the current closing section exactly as written and add no other links. If the current section ends with a short general-information note, keep that paragraph unchanged as the last paragraph.",
        `VOICE GUIDE\n${voiceGuide(settings)}\n\n${facts}\n\nARTICLE TITLE\n${article.h1}\n\nCURRENT CLOSING SECTION\n## ${c.heading}\n\n${c.body}`,
        0.3,
      );
      const body = rewrite?.body_markdown?.trim();
      const heading = rewrite?.heading?.replace(/^#+\s*/, "").trim();
      if (body && heading && tokensIn(body) === tokensIn(c.body) && !/\]\((?!\{\{PRODUCT_URL)[^)]*\)/.test(body) && body.split(/\s+/).length >= 25) {
        const next = `${article.body_markdown.slice(0, c.start)}## ${heading}\n\n${body}\n`;
        if (!genericClosing(next)) article.body_markdown = next;
      }
    }
  }

  await progress("Checking every sentence against your facts");
  let report = await audit(article);
  for (let round = 1; round <= 2; round++) {
    const repeats = findRepeats(article.body_markdown);
    const problems = { unsupported: report.unsupported, risky: report.risky, leaks: report.leaks, repetition: repeats };
    const count = report.unsupported.length + report.risky.length + report.leaks.length + repeats.length;
    if (!count) break;
    await progress(`Fixing ${count} unsupported sentence${count === 1 ? "" : "s"} (round ${round})`);
    const fix = await call<{ edits?: { find?: string; replace?: string }[] }>(
      fixerPrompt,
      `ARTICLE\n${JSON.stringify(
        { tldr: article.tldr, excerpt: article.excerpt, email_body: article.email_body, social_post: article.social_post, body_markdown: maskLinks(article.body_markdown).text, faq: article.faq },
        null,
        1,
      )}\n\nPROBLEMS\n${JSON.stringify(problems, null, 1)}\n\n${facts}`,
      0,
    );
    apply(article, fix.edits || []);
    report = await audit(article);
  }

  await progress("Final checks");
  if (!guide) article.body_markdown = repairLink(article.body_markdown, product.title.split(/\s[–|-]\s/)[0]);
  // Optional links to the store's own collections and one related article. Only words already in the text are linked.
  if (links && (settings.linkToCollections || settings.linkToOtherArticles)) {
    const withLinks = addInternalLinks(article.body_markdown, links, {
      collections: settings.linkToCollections,
      articles: settings.linkToOtherArticles,
    }, article.h1 || "");
    article.body_markdown = withLinks.md;
    // No article matched on shared words: ask the model which existing article a reader would genuinely want next,
    // including broader themes (plastic-free living, low waste kitchens). It only chooses a title and quotes words
    // already in this article to link; code confirms those words exist, so nothing new can be added.
    const candidates = links.articles.filter((a) => !(a.keyword && links.selfKeyword && sameKeyword(a.keyword, links.selfKeyword))).slice(0, 100);
    if (settings.linkToOtherArticles && !withLinks.added.some((x) => x.kind === "article") && candidates.length) {
      try {
        await progress("Looking for a related article to link");
        const pick = await call<{ index?: number | null; anchor?: string }>(
          'You choose ONE existing blog article that readers of a new article would genuinely want to read next, or none. Return ONLY JSON {"index": <number from the list, or null>, "anchor": "<2 to 5 words copied exactly from the NEW ARTICLE BODY>"}. Choose an article on the same subject or a closely related broader theme (for example a reusable bag article can link to plastic-free living or single-use plastic articles; a kitchen product can link to low-waste kitchen articles). Do NOT choose an article that covers the same topic or search phrase as the new article, nor one only loosely connected by a single shared word. If nothing is clearly useful to the reader, return {"index": null, "anchor": ""}. The anchor must be words that already appear in an ordinary paragraph of the NEW ARTICLE BODY (not a heading, not the first paragraph) and that point naturally to the chosen article\'s subject.',
          `NEW ARTICLE TITLE\n${article.h1}\n\nNEW ARTICLE SEARCH PHRASE\n${links.selfKeyword}\n\nNEW ARTICLE BODY\n${article.body_markdown.replace(/\]\([^)]*\)/g, "]")}\n\nEXISTING ARTICLES\n${candidates.map((a, i) => `${i}: ${a.title}`).join("\n")}`,
          0,
        );
        const chosen = typeof pick?.index === "number" ? candidates[pick.index] : undefined;
        if (chosen && pick.anchor) {
          const placed = addLinkOnPhrase(article.body_markdown, pick.anchor, chosen.path);
          if (placed) {
            article.body_markdown = placed.md;
            withLinks.added.push({ kind: "article", phrase: placed.phrase, path: chosen.path });
          }
        }
      } catch (e) {
        console.error("Related article lookup failed", e);
      }
    }
    console.log(`Internal links: ${links.collections.length} collections and ${links.articles.length} articles considered, ${withLinks.added.length} added`);
  }
  for (let i = 0; i < 2 && (article.title_tag.length > 60 || article.meta_description.length > 155); i++) {
    const t = await call<{ title_tag?: string; meta_description?: string }>(
      'You shorten SEO fields. Return ONLY JSON {"title_tag":"<=60 chars","meta_description":"<=155 chars"}. Keep the meaning and the key facts; do not add claims.',
      JSON.stringify({ title_tag: article.title_tag, meta_description: article.meta_description }),
      0,
    );
    article.title_tag = t.title_tag || article.title_tag;
    article.meta_description = t.meta_description || article.meta_description;
  }

  const checks = runChecks(article);
  const remaining: AuditProblem[] = [
    ...report.unsupported,
    ...report.risky,
    ...report.leaks,
    ...findRepeats(article.body_markdown),
  ];
  const status = remaining.length === 0 && checks.issues.length === 0 ? "READY FOR MERCHANT APPROVAL" : "NEEDS REVIEW";
  return { article, status, words: checks.words, issues: checks.issues, remaining, tokens };
}
