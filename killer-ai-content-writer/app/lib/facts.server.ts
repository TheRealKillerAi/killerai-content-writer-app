import db from "../db.server";
import type { Angle, MerchantFacts } from "./pipeline/types";

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

export async function loadAngles(shop: string, productId: string): Promise<Angle[]> {
  const row = await db.productAngles.findUnique({ where: { shop_productId: { shop, productId } } });
  return row ? (JSON.parse(row.angles) as Angle[]) : [];
}

export async function saveAngles(shop: string, productId: string, angles: Angle[]) {
  const data = { angles: JSON.stringify(angles) };
  await db.productAngles.upsert({
    where: { shop_productId: { shop, productId } },
    create: { shop, productId, ...data },
    update: data,
  });
}
