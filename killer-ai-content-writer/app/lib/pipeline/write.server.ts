import writerPrompt from "./prompts/writer.md?raw";
import auditorPrompt from "./prompts/auditor.md?raw";
import fixerPrompt from "./prompts/fixer.md?raw";
import voice from "./voice/default.md?raw";
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
import type { Angle, Article, ArticleResult, AuditProblem, AuditReport, MerchantFacts, ProductFacts } from "./types";

const LINK = /\[[^\]]+\]\(\{\{PRODUCT_URL\}\}\)/;
const MASK = "⟦PRODUCT_LINK⟧";

type Progress = (stage: string) => Promise<void> | void;

export async function writeArticle(
  product: ProductFacts,
  angle: Angle,
  merchant: MerchantFacts,
  progress: Progress = () => {},
): Promise<ArticleResult> {
  let tokens = 0;
  const call = async <T>(system: string, user: string, temperature: number): Promise<T> => {
    const r = await chatJson<T>(system, user, { temperature });
    tokens += r.tokens;
    return r.json;
  };

  const facts = `PRODUCT DATA\n${JSON.stringify(product, null, 2)}\n\nMERCHANT FACTS\n${JSON.stringify(
    merchant.known,
    null,
    2,
  )}\n\nUNKNOWN TO THE MERCHANT (do not cover, estimate or hint at these)\n${JSON.stringify(merchant.unknown)}`;
  const gaps = [...(angle.needs_info?.filter(Boolean) ?? []), ...merchant.unknown];

  await progress("Writing the article");
  const article = await call<Article>(
    writerPrompt,
    `VOICE GUIDE\n${voice}\n\n${facts}\n\nUNAVAILABLE FACTS\n${JSON.stringify(gaps)}\n\nCHOSEN ANGLE\n${JSON.stringify(
      angle,
    )}\n\nSOURCES PROVIDED\nnone`,
    0.6,
  );
  article.faq = Array.isArray(article.faq) ? article.faq : [];
  article.tldr = article.tldr ?? "";
  article.body_markdown = article.body_markdown ?? "";

  const audit = async (art: Article): Promise<AuditReport> => {
    const sentences = splitSentences(art);
    const listing = (ss: typeof sentences) => ss.map((x) => `${x.id}: ${x.text}`).join("\n");
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
    const link = (art.body_markdown.match(LINK) || [null])[0];
    art.body_markdown = art.body_markdown.replace(LINK, MASK);
    const swap = (s: string) => {
      for (const e of edits)
        if (e.find && !e.find.includes("{{PRODUCT_URL}}") && s.includes(e.find)) s = s.replace(e.find, e.replace ?? "");
      return s;
    };
    art.tldr = swap(art.tldr);
    art.body_markdown = swap(art.body_markdown)
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/ {2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n");
    art.body_markdown = cleanStructure(removeRepeats(art.body_markdown));
    if (link) art.body_markdown = art.body_markdown.replace(MASK, link);
    art.faq = art.faq.map((f) => ({ q: swap(f.q), a: swap(f.a) })).filter((f) => f.a.trim());
  };

  article.body_markdown = cleanStructure(removeRepeats(article.body_markdown));

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
        { tldr: article.tldr, body_markdown: article.body_markdown.replace(LINK, MASK), faq: article.faq },
        null,
        1,
      )}\n\nPROBLEMS\n${JSON.stringify(problems, null, 1)}\n\n${facts}`,
      0,
    );
    apply(article, fix.edits || []);
    report = await audit(article);
  }

  await progress("Final checks");
  article.body_markdown = repairLink(article.body_markdown, product.title.split(/\s[–|-]\s/)[0]);
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
