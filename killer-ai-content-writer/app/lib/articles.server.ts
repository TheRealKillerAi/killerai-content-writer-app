import { waitUntil } from "@vercel/functions";
import db from "../db.server";
import { LlmError } from "./pipeline/llm.server";
import { writeArticle } from "./pipeline/write.server";
import { buildBodyHtml } from "./articleHtml";
import { scoreArticle } from "./score";
import { loadLinkTargets } from "./links.server";
import type { Admin } from "./products.server";
import type { AppSettings } from "./settings";
import type { Covered } from "./keywords";
import { articleText, cleanStructure, findRepeats, removeRepeats, runChecks } from "./pipeline/checks";
import type { Angle, Article, ArticleResult, AuditProblem, ReviewedSentence, SentInfo, MerchantFacts, ProductFacts } from "./pipeline/types";

/** A sentence in lower case without punctuation, so the same sentence is recognised in a later article. */
const reviewKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160);
const isRepeat = (p: AuditProblem) => /^copies an earlier/.test(p.problem);
const statusOf = (remaining: AuditProblem[], issues: string[]): ArticleResult["status"] =>
  remaining.length === 0 && issues.length === 0 ? "READY FOR MERCHANT APPROVAL" : "NEEDS REVIEW";

async function execute(
  rowId: string,
  product: ProductFacts,
  angle: Angle,
  merchant: MerchantFacts,
  settings: AppSettings,
  guide?: ProductFacts[],
  shopAndAdmin?: { shop: string; admin?: Admin },
) {
  const startedAt = Date.now();
  try {
    const links = shopAndAdmin ? await loadLinkTargets(shopAndAdmin.admin, shopAndAdmin.shop, settings, angle.target_query ?? "", rowId) : undefined;
    let result = await writeArticle(product, angle, merchant, async (stage) => {
      await db.article.update({ where: { id: rowId }, data: { stage } });
    }, settings, guide, links);
    // Sentences the merchant has already confirmed as correct in an earlier article are not flagged again.
    if (shopAndAdmin && result.remaining.length) {
      try {
        const accepted = await db.sentenceReview.findMany({ where: { shop: shopAndAdmin.shop, decision: "accepted" }, select: { key: true }, take: 1000 });
        const keys = new Set(accepted.map((a) => a.key));
        const known = result.remaining.filter((p) => !isRepeat(p) && keys.has(reviewKey(p.text)));
        if (known.length) {
          const remaining = result.remaining.filter((p) => !known.includes(p));
          const at = new Date().toISOString();
          const reviewed: ReviewedSentence[] = known.map((p) => ({ text: p.text, problem: p.problem, decision: "accepted", by: "an earlier decision", at, remembered: true }));
          result = { ...result, remaining, reviewed: [...(result.reviewed ?? []), ...reviewed], status: statusOf(remaining, result.issues) };
        }
      } catch (e) {
        console.error("Could not apply earlier sentence decisions", e);
      }
    }
    await db.article.update({
      where: { id: rowId },
      data: { state: "done", stage: "Done", result: JSON.stringify({ ...result, seconds: Math.round((Date.now() - startedAt) / 1000) }) },
    });
  } catch (e) {
    const message = e instanceof LlmError ? e.message : "Something went wrong while writing. Please try again.";
    if (!(e instanceof LlmError)) console.error("Article job failed", e);
    await db.article.update({ where: { id: rowId }, data: { state: "failed", error: message } });
  }
}

/** Starts writing in the background and returns the new article id straight away. */
export async function startArticle(
  shop: string,
  productId: string,
  product: ProductFacts,
  angle: Angle,
  merchant: MerchantFacts,
  settings: AppSettings,
  guide?: ProductFacts[],
  admin?: Admin,
): Promise<string> {
  const row = await db.article.create({ data: { shop, productId, angle: JSON.stringify(angle), keyword: angle.target_query, title: angle.working_title } });
  // waitUntil keeps the hosted function alive after the response; locally it simply runs.
  waitUntil(execute(row.id, product, angle, merchant, settings, guide, { shop, admin }));
  return row.id;
}

/** Writes an article and waits for it to finish (used by the scheduler, which is already running in the background). */
export async function writeArticleNow(
  shop: string,
  productId: string,
  product: ProductFacts,
  angle: Angle,
  merchant: MerchantFacts,
  settings: AppSettings,
  guide?: ProductFacts[],
  admin?: Admin,
): Promise<string> {
  const row = await db.article.create({ data: { shop, productId, angle: JSON.stringify(angle), keyword: angle.target_query, title: angle.working_title } });
  await execute(row.id, product, angle, merchant, settings, guide, { shop, admin });
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
      (p) => !/^copies an earlier/.test(p.problem) && text.includes(p.text.replace(/^[-*+\d.\s]+/, "").slice(0, 60)),
    ),
    ...findRepeats(article.body_markdown).filter((p) => !(prev.reviewed ?? []).some((r) => reviewKey(r.text) === reviewKey(p.text))),
  ];
  const next: ArticleResult = {
    ...prev,
    article,
    words: checks.words,
    issues: checks.issues,
    remaining,
    status: statusOf(remaining, checks.issues),
    edited: true,
  };
  await db.article.update({ where: { id }, data: { result: JSON.stringify(next) } });
  return next;
}

/**
 * The merchant confirms a flagged sentence is correct ("accepted") or chooses to leave it ("ignored").
 * Either way it stops blocking the article, and the decision is kept as an audit record.
 */
export async function reviewSentence(shop: string, id: string, text: string, decision: "accepted" | "ignored", by: string) {
  const row = await db.article.findFirst({ where: { id, shop } });
  if (!row?.result) return null;
  const prev = JSON.parse(row.result) as ArticleResult;
  const found = prev.remaining.find((p) => p.text === text);
  if (!found) return prev;
  const remaining = prev.remaining.filter((p) => p !== found);
  const reviewed: ReviewedSentence[] = [...(prev.reviewed ?? []), { text: found.text, problem: found.problem, decision, by, at: new Date().toISOString() }];
  const next: ArticleResult = { ...prev, remaining, reviewed, status: statusOf(remaining, prev.issues) };
  await db.sentenceReview.create({
    data: { shop, articleId: id, sentence: found.text, key: reviewKey(found.text), problem: found.problem, decision, decidedBy: by },
  });
  await db.article.update({ where: { id }, data: { result: JSON.stringify(next) } });
  return next;
}

export async function dedupeArticle(shop: string, id: string) {
  const row = await db.article.findFirst({ where: { id, shop } });
  if (!row?.result) return null;
  const prev = JSON.parse(row.result) as ArticleResult;
  const article = { ...prev.article, body_markdown: cleanStructure(removeRepeats(prev.article.body_markdown)), body_html: undefined };
  return saveEdits(shop, id, article);
}

export type ArticleListItem = {
  id: string;
  productId: string;
  state: "writing" | "done" | "failed";
  title: string;
  status: string | null;
  keyword: string | null;
  sentAs: "draft" | "live" | null;
  seo: number | null;
  createdAt: string;
};

export async function listArticles(shop: string, productId?: string): Promise<ArticleListItem[]> {
  const rows = await db.article.findMany({
    where: { shop, ...(productId ? { productId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((r) => {
    const result = r.result ? (JSON.parse(r.result) as ArticleResult) : null;
    const angle = JSON.parse(r.angle) as Angle;
    let seo: number | null = null;
    if (result) {
      try {
        // The product link is always added by the writer, so a stand-in handle keeps that check from failing here.
        seo = scoreArticle(result.article, {
          html: buildBodyHtml(result.article, "x", false),
          keyword: r.keyword ?? angle.target_query ?? "",
          productHandle: "x",
          author: "",
        }).seo.score;
      } catch {
        seo = null;
      }
    }
    return {
      seo,
      id: r.id,
      productId: r.productId,
      state: r.state as ArticleListItem["state"],
      title: result?.article.h1 || angle.working_title,
      status: result?.status ?? null,
      keyword: r.keyword ?? angle.target_query ?? null,
      sentAs: r.sentAs === "draft" || r.sentAs === "live" ? r.sentAs : null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function deleteArticle(shop: string, id: string) {
  await db.article.deleteMany({ where: { id, shop } });
}

export async function setSent(shop: string, id: string, sent: SentInfo) {
  const row = await db.article.findFirst({ where: { id, shop } });
  if (!row?.result) return;
  const prev = JSON.parse(row.result) as ArticleResult;
  await db.article.update({
    where: { id },
    data: { result: JSON.stringify({ ...prev, sent }), sentAs: sent.published ? "live" : "draft" },
  });
}

/** Every article started in this shop, with the search phrase it targets, so new topics can avoid competing with them. */
export async function coveredTopics(shop: string): Promise<Covered[]> {
  const rows = await db.article.findMany({
    where: { shop, state: { in: ["writing", "done"] } },
    select: { id: true, productId: true, keyword: true, title: true, sentAs: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return rows.map((r: { id: string; productId: string; keyword: string | null; title: string | null; sentAs: string | null }) => ({
    ...r,
    sentAs: r.sentAs === "draft" || r.sentAs === "live" ? r.sentAs : null,
  }));
}
