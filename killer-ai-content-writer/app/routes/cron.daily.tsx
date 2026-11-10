import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { runAllShops, runInBackground } from "../lib/schedule.server";

// Called once a day by Vercel Cron, which sends "Authorization: Bearer <CRON_SECRET>".
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // eslint-disable-next-line no-undef
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  // AI Refresh keeps the old text of an updated post for 30 days so it can be undone, then lets it go.
  await db.refreshRun.updateMany({ where: { appliedAt: { lt: new Date(Date.now() - 31 * 86400000) }, bodyBefore: { not: null } }, data: { bodyBefore: null, bodyAfter: null } });
  runInBackground(runAllShops());
  return new Response("Started", { status: 200 });
};
