import writerPrompt from "./prompts/writer.md?raw";
import auditorPrompt from "./prompts/auditor.md?raw";
import fixerPrompt from "./prompts/fixer.md?raw";
import guideWriterPrompt from "./prompts/guide-writer.md?raw";
import { DEFAULT_SETTINGS, settingsContext, voiceGuide, type AppSettings } from "../settings";
import { chatJson } from "./llm.server";
import {
  cleanStructure,
  findRepeats,
  removeRepeats,
  repairLink,
  runChecks,
  splitSentences,
  verifyLabels,
} from "./checks";
import { addInternalLinks, type LinkTargets } from "./links";
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
      "You expand an article that is slightly under 500 words in its tldr, body and FAQ. Return the SAME JSON object with the same keys, rewritten to reach at least 540 words in total across tldr, body_markdown and faq. Develop facts already present in PRODUCT DATA and MERCHANT FACTS more fully: add a short section, explain how a supplied fact helps the reader, or give fuller FAQ answers. NEVER pad, repeat yourself, or add any claim, number, benefit or suitability statement that is not in the facts. Anything under UNKNOWN TO THE MERCHANT must not appear anywhere, including email_body and social_post. Keep every {{PRODUCT_URL...}} link and {{ARTICLE_URL}} exactly as written, keep the voice, and keep the email and social copy to supplied facts only.",
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
    });
    article.body_markdown = withLinks.md;
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
