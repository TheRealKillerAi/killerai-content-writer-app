import db from "../db.server";
import { LlmError } from "./pipeline/llm.server";
import { writeArticle } from "./pipeline/write.server";
import type { Angle, ArticleResult, MerchantFacts, ProductFacts } from "./pipeline/types";

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
