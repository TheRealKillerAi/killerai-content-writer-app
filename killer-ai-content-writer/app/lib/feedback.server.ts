import db from "../db.server";

export const SUPPORT_EMAIL = "support@killerai.co";

export async function saveFeedback(
  shop: string,
  input: { kind: "message" | "thumb"; rating?: number | null; message?: string; context?: string },
) {
  const message = input.message?.trim().slice(0, 4000) || null;
  const rating = input.rating === 1 || input.rating === -1 ? input.rating : null;
  if (input.kind === "message" && !message) return false;
  if (input.kind === "thumb" && rating === null) return false;
  await db.feedback.create({
    data: { shop, kind: input.kind, rating, message, context: input.context?.slice(0, 200) || null },
  });
  return true;
}

/** Stores allowed to see all feedback: the app owner's stores. Set ADMIN_SHOPS (comma separated) to change. */
export function isAdminShop(shop: string) {
  const list = (process.env.ADMIN_SHOPS ?? "killerai-writer-app.myshopify.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(shop.toLowerCase());
}

export async function listFeedback(limit = 200) {
  return db.feedback.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
