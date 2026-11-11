import { timingSafeEqual } from "node:crypto";

// True only when the request carries "Authorization: Bearer <CRON_SECRET>". Compared in constant time.
export function cronAuthorized(request: Request): boolean {
  // eslint-disable-next-line no-undef
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
