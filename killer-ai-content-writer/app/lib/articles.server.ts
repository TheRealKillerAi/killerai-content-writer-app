import db from "../db.server";
import { LlmError } from "./pipeline/llm.server";
import { writeArticle } from "./pipeline/write.server";
import { articleText, cleanStructure, findRepeats, removeRepeats, runChecks } from "./pipeline/checks";
import type { Angle, Article, ArticleResult, MerchantFacts, ProductFacts } from "./pipeline/types";

/** Starts writing in the background and returns the new article id straight away. */
export async function startArticle(
  shop: string,
  productId: string,
  product: ProductFacts,
  angle: Angle,
  merchant: MerchantFacts,
): Promise<string> {
  const row = await db.article.create({ data: { shop, productId, angle: JSON.stringify(angle) } });
  void (async () => {
    try {
      const result = await writeArticle(product, angle, merchant, async (stage) => {
        await db.article.update({ where: { id: row.id }, data: { stage } });
      });
      await db.article.update({
        where: { id: row.id },
        data: { state: "done", stage: "Done", result: JSON.stringify(result) },
      });
    } catch (e) {
      const message = e instanceof LlmError ? e.message : "Something went wrong while writing. Please try again.";
      if (!(e instanceof LlmError)) console.error("Article job failed", e);
      await db.article.update({ where: { id: row.id }, data: { state: "failed", error: message } });
    }
  })();
  return row.id;
}

export async function getArticle(shop: string, id: string) {
  const row = await db.article.findFirst({ where: { id, shop } });
  if (!row) return null;
  // A server restart mid-write would leave the job "writing" forever.
  if (row.state === "writing" && Date.now() - row.updatedAt.getTime() > 10 * 60 * 1000) {
    await db.article.update({ where: { id }, data: { state: "failed", error: "This took too long or was interrupted. Please try again." } });
    row.state = "failed";
    row.error = "This took too long or was interrupted. Please try again.";
  }
  return {
    id: row.id,
    productId: row.productId,
    state: row.state as "writing" | "done" | "failed",
    stage: row.stage,
    error: row.error,
    angle: JSON.parse(row.angle) as Angle,
    result: row.result ? (JSON.parse(row.result) as ArticleResult) : null,
  };
}

/** Saves the merchant's edits and re-runs the deterministic checks. Edits themselves are not AI fact-checked. */
export async function saveEdits(shop: string, id: string, article: Article) {
  const row = await db.article.findFirst({ where: { id, shop } });
  if (!row?.result) return null;
  const prev = JSON.parse(row.result) as ArticleResult;
  const checks = runChecks(article);
  const text = articleText(article);
  // Repeats are always re-detected from the current text; other audit findings stay only while their sentence is still there.
  const remaining = [
    ...prev.remaining.filter(
      (p) => !/^repeats an earlier/.test(p.problem) && text.includes(p.text.replace(/^[-*+\d.\s]+/, "").slice(0, 60)),
    ),
    ...findRepeats(article.body_markdown),
  ];
  const next: ArticleResult = {
    ...prev,
    article,
    words: checks.words,
    issues: checks.issues,
    remaining,
    status: remaining.length === 0 && checks.issues.length === 0 ? "READY FOR MERCHANT APPROVAL" : "NEEDS REVIEW",
    edited: true,
  };
  await db.article.update({ where: { id }, data: { result: JSON.stringify(next) } });
  return next;
}

export async function dedupeArticle(shop: string, id: string) {
  const row = await db.article.findFirst({ where: { id, shop } });
  if (!row?.result) return null;
  const prev = JSON.parse(row.result) as ArticleResult;
  const article = { ...prev.article, body_markdown: cleanStructure(removeRepeats(prev.article.body_markdown)) };
  return saveEdits(shop, id, article);
}
