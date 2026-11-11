import type { ActionFunctionArgs } from "react-router";
import { cronAuthorized } from "../lib/cronAuth.server";
import { unauthenticated } from "../shopify.server";
import { effectiveZone, fillChain, runInBackground, shopInfo } from "../lib/schedule.server";
import { loadEffectiveSettings } from "../lib/settings.server";
import type { Admin } from "../lib/products.server";

// Carries on a long topic search in a fresh run. Only called by the app itself, with the shared secret.
export const action = async ({ request }: ActionFunctionArgs) => {
  if (!cronAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { shop?: string; chain?: number; force?: boolean; write?: boolean };
  if (!body.shop || !/^[a-z0-9-]+\.myshopify\.com$/.test(body.shop)) return new Response("Bad request", { status: 400 });
  const shop = body.shop;
  runInBackground(
    (async () => {
      const { admin } = await unauthenticated.admin(shop);
      const a = admin as unknown as Admin;
      const settings = await loadEffectiveSettings(a, shop);
      const tz = effectiveZone(settings, (await shopInfo(a)).tz);
      await fillChain(shop, a, settings, tz, { force: !!body.force, write: !!body.write, chain: Number(body.chain) || 1 });
    })(),
  );
  return new Response("Continuing", { status: 200 });
};
