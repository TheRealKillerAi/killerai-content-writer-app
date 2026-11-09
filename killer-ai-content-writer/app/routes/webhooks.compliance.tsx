import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Shopify's mandatory privacy webhooks.
 * - customers/data_request and customers/redact: the app stores no customer
 *   personal data (only shop-level settings, facts, articles and feedback), so
 *   there is nothing to return or delete. We acknowledge them.
 * - shop/redact: sent 48 hours after uninstall; we delete everything for the shop.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const t = String(topic).toLowerCase().replace(/[/_]/g, "");

  if (t === "shopredact") {
    await db.$transaction([
      db.article.deleteMany({ where: { shop } }),
      db.productAngles.deleteMany({ where: { shop } }),
      db.merchantFact.deleteMany({ where: { shop } }),
      db.shopSettings.deleteMany({ where: { shop } }),
      db.feedback.deleteMany({ where: { shop } }),
      db.author.deleteMany({ where: { shop } }),
      db.scheduledPost.deleteMany({ where: { shop } }),
      db.session.deleteMany({ where: { shop } }),
    ]);
    console.log(`Deleted all data for ${shop} (shop/redact)`);
  } else {
    console.log(`Acknowledged ${topic} for ${shop}; no customer data is stored`);
  }

  return new Response();
};
