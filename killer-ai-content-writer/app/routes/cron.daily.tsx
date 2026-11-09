import type { LoaderFunctionArgs } from "react-router";
import { runAllShops, runInBackground } from "../lib/schedule.server";

// Called once a day by Vercel Cron, which sends "Authorization: Bearer <CRON_SECRET>".
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // eslint-disable-next-line no-undef
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  runInBackground(runAllShops());
  return new Response("Started", { status: 200 });
};
