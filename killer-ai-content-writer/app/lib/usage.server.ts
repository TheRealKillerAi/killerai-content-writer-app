import db from "../db.server";

/** The plan every shop is on while the app is being tested. Real plans and billing come at launch. */
export const CURRENT_PLAN = { name: "Free (testing)", monthlyArticles: 30 };

export type Usage = { used: number; limit: number; plan: string; resetsOn: string };

/** Articles written this calendar month. Failed articles don't count. */
export async function monthlyUsage(shop: string): Promise<Usage> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const used = await db.article.count({ where: { shop, state: { in: ["writing", "done"] }, createdAt: { gte: start } } });
  return { used, limit: CURRENT_PLAN.monthlyArticles, plan: CURRENT_PLAN.name, resetsOn: next.toISOString() };
}
