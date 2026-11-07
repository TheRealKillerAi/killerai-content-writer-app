import db from "../db.server";
import type { MerchantFacts } from "./pipeline/types";

export async function loadFacts(shop: string, productId: string): Promise<MerchantFacts> {
  const rows = await db.merchantFact.findMany({ where: { shop, productId } });
  const known: Record<string, string> = {};
  const unknown: string[] = [];
  for (const r of rows) (r.unknown ? unknown.push(r.question) : (known[r.question] = r.answer));
  return { known, unknown };
}

export async function saveFacts(
  shop: string,
  productId: string,
  items: { question: string; answer: string; unknown: boolean }[],
) {
  for (const it of items) {
    const answer = it.answer.trim();
    if (!it.unknown && !answer) continue; // skipped: ask again later
    await db.merchantFact.upsert({
      where: { shop_productId_question: { shop, productId, question: it.question } },
      create: { shop, productId, question: it.question, answer: it.unknown ? "" : answer, unknown: it.unknown },
      update: { answer: it.unknown ? "" : answer, unknown: it.unknown },
    });
  }
}

export async function deleteFact(shop: string, productId: string, question: string) {
  await db.merchantFact.deleteMany({ where: { shop, productId, question } });
}
