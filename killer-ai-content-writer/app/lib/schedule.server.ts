import { waitUntil } from "@vercel/functions";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getAuthor } from "./authors.server";
import { esc } from "./articleHtml";
import { sendEmail } from "./email.server";
import { coveredTopics, getArticle, saveEdits, setSent, writeArticleNow } from "./articles.server";
import { loadAngles, loadFacts, saveAngles } from "./facts.server";
import { findCovered } from "./keywords";
import { findAngles } from "./pipeline/angles.server";
import { sendToShopify } from "./publish.server";
import { existingArticleTitles, getProduct, gql, listProducts, productImages, type Admin } from "./products.server";
import { loadEffectiveSettings, validZone } from "./settings.server";
import type { AppSettings } from "./settings";
import type { Angle } from "./pipeline/types";

/** How far ahead topics are scheduled, and how long before publishing the article is written. */
const HORIZON_DAYS = 7;
const WRITE_WINDOW_HOURS = 36;

// ---------- time zones ----------
function offsetMinutes(utcMs: number, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
  );
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs) / 60000;
}

/** The UTC moment that is the given wall-clock time in the given zone. */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let res = guess - offsetMinutes(guess, tz) * 60000;
  const again = offsetMinutes(res, tz);
  if (again !== offsetMinutes(guess, tz)) res = guess - again * 60000;
  return new Date(res);
}

function localDate(now: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day };
}

/** Publish times the schedule calls for in the next week. */
export function upcomingSlots(s: AppSettings, tz: string, now = new Date()): Date[] {
  const days = new Set(s.scheduleDays.split(",").map(Number));
  const [hh, mm] = s.scheduleTime.split(":").map(Number);
  const { y, m, d } = localDate(now, tz);
  const out: Date[] = [];
  for (let i = 0; i <= HORIZON_DAYS + 1; i++) {
    const day = new Date(Date.UTC(y, m - 1, d) + i * 86400000);
    if (!days.has(day.getUTCDay())) continue;
    const at = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, tz);
    if (at.getTime() > now.getTime() + 3600000 && at.getTime() <= now.getTime() + HORIZON_DAYS * 86400000) out.push(at);
  }
  return out;
}

export async function shopInfo(admin: Admin): Promise<{ email: string; tz: string }> {
  try {
    const d = await gql<{ shop: { email: string; ianaTimezone: string } }>(admin, `#graphql\n      query ShopInfo { shop { email ianaTimezone } }`);
    return { email: d.shop.email ?? "", tz: d.shop.ianaTimezone ?? "UTC" };
  } catch {
    return { email: "", tz: "UTC" };
  }
}

export const effectiveZone = (s: AppSettings, shopTz: string) => (validZone(s.timeZone) ? s.timeZone : validZone(shopTz) ? shopTz : "UTC");

const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---------- choosing topics ----------
function pickAngle(angles: Angle[], taken: Set<string>, covered: Awaited<ReturnType<typeof coveredTopics>>): Angle | null {
  const ok = angles.filter(
    (a) =>
      !a.overlaps_existing &&
      a.risk !== "high" &&
      !a.needs_outside_evidence &&
      !taken.has(key(a.working_title)) &&
      !taken.has(key(a.target_query)) &&
      !findCovered(a, covered),
  );
  const rank = (a: Angle) => a.needs_info.length * 100 - a.answerable_from_data;
  return ok.filter((a) => a.needs_info.length <= 1).sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Adds topics for any upcoming publish slot that doesn't have one yet. Topics only: the article is written later. */
export async function topUpSchedule(shop: string, admin: Admin, settings: AppSettings, tz: string): Promise<number> {
  const now = new Date();
  const existing = await db.scheduledPost.findMany({ where: { shop, publishAt: { gte: now } } });
  const have = new Set(existing.map((e: { publishAt: Date }) => e.publishAt.getTime()));
  const missing = upcomingSlots(settings, tz, now).filter((s) => !have.has(s.getTime()));
  if (!missing.length) return 0;

  // Products, least recently used first.
  const rows: { id: string; title: string }[] = [];
  let after: string | null = null;
  for (let i = 0; i < 3; i++) {
    const page = await listProducts(admin, "status:active", after);
    rows.push(...page.products.map((p) => ({ id: p.id, title: p.title })));
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  const numeric = (gid: string) => gid.split("/").pop()!;
  const lastUsed = new Map<string, number>();
  for (const a of await db.article.findMany({ where: { shop }, select: { productId: true, createdAt: true } }))
    lastUsed.set(a.productId, Math.max(lastUsed.get(a.productId) ?? 0, a.createdAt.getTime()));
  for (const e of await db.scheduledPost.findMany({ where: { shop }, select: { productId: true, publishAt: true } }))
    lastUsed.set(e.productId, Math.max(lastUsed.get(e.productId) ?? 0, e.publishAt.getTime()));
  const order = rows.sort((a, b) => (lastUsed.get(numeric(a.id)) ?? 0) - (lastUsed.get(numeric(b.id)) ?? 0));

  const taken = new Set<string>();
  for (const e of existing) {
    const a = JSON.parse(e.angle) as Angle;
    taken.add(key(a.working_title));
    taken.add(key(a.target_query));
  }
  const covered = await coveredTopics(shop);
  const used = new Set<string>();
  const tried = new Set<string>();
  let created = 0;

  for (const slot of missing) {
    let placed = false;
    for (const p of order) {
      if (placed) break;
      const pid = numeric(p.id);
      if (used.has(pid) || tried.has(pid)) continue;
      tried.add(pid);
      const product = await getProduct(admin, p.id);
      if (!product) continue;
      const facts = await loadFacts(shop, pid);
      let angles = await loadAngles(shop, pid);
      let angle = pickAngle(angles, taken, covered);
      if (!angle) {
        try {
          const titles = [...(await existingArticleTitles(admin)), ...angles.map((a) => a.working_title), ...covered.flatMap((c) => [c.title, c.keyword].filter((x): x is string => !!x))];
          const { angles: fresh } = await findAngles(product.facts, titles, facts.known, settings);
          const seen = new Set(angles.flatMap((a) => [key(a.working_title), key(a.target_query)]));
          angles = [...angles, ...fresh.filter((a) => !seen.has(key(a.working_title)) && !seen.has(key(a.target_query)))].slice(0, 30);
          await saveAngles(shop, pid, angles);
          angle = pickAngle(angles, taken, covered);
        } catch (e) {
          console.error("Topic search failed", e);
        }
      }
      if (!angle) continue;
      const image = settings.scheduleImage === "product" ? (await productImages(admin, p.id))[0] : undefined;
      await db.scheduledPost.create({
        data: {
          shop,
          productId: pid,
          productTitle: p.title,
          angle: JSON.stringify(angle),
          publishAt: slot,
          authorId: settings.defaultAuthorId,
          imageUrl: image?.url ?? "",
          imageAlt: image?.alt || p.title,
        },
      });
      taken.add(key(angle.working_title));
      taken.add(key(angle.target_query));
      used.add(pid);
      created++;
      placed = true;
    }
  }
  return created;
}

// ---------- links and emails ----------
const scheduleLink = (shop: string) =>
  // eslint-disable-next-line no-undef
  `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/apps/${process.env.SHOPIFY_API_KEY}/app/schedule`;

const when = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(d);

const wrap = (inner: string) =>
  `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#202223;line-height:1.5">${inner}<p style="color:#6d7175;font-size:13px;margin-top:32px">KillerAi Content Writer</p></div>`;

async function recipient(settings: AppSettings, admin: Admin) {
  return settings.notifyEmail || (await shopInfo(admin)).email;
}

async function sendDigest(shop: string, admin: Admin, settings: AppSettings, tz: string) {
  if (settings.notifyUpcoming !== "weekly") return;
  const fresh = await db.scheduledPost.findMany({ where: { shop, notified: false, status: "scheduled", publishAt: { gte: new Date() } }, orderBy: { publishAt: "asc" } });
  if (!fresh.length) return;
  const items = fresh
    .map((p: { id: string; publishAt: Date; imageUrl: string; imageAlt: string; angle: string; productTitle: string }) => {
      const a = JSON.parse(p.angle) as Angle;
      const img = p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.imageAlt)}" width="72" height="72" style="border-radius:6px;object-fit:cover;display:block">` : "";
      return `<tr><td style="padding:10px 12px 10px 0;vertical-align:top">${img}</td><td style="padding:10px 0;vertical-align:top;border-bottom:1px solid #e1e3e5"><strong>${esc(a.working_title)}</strong><br><span style="color:#6d7175">${esc(p.productTitle)} · ${esc(when(p.publishAt, tz))}</span></td></tr>`;
    })
    .join("");
  const ok = await sendEmail({
    to: await recipient(settings, admin),
    subject: `Your upcoming articles: ${fresh.length} scheduled`,
    html: wrap(
      `<h2 style="margin:0 0 8px">Your upcoming articles</h2><p>These topics are scheduled. Each article is written about a day before it goes out, so there's time to change a topic or picture, or remove one you don't want.</p><table style="width:100%;border-collapse:collapse">${items}</table><p><a href="${scheduleLink(shop)}" style="display:inline-block;background:#303030;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Review your schedule</a></p><p style="color:#6d7175;font-size:13px">You can switch these emails off in Settings under Notifications.</p>`,
    ),
  });
  if (ok) await db.scheduledPost.updateMany({ where: { id: { in: fresh.map((f: { id: string }) => f.id) } }, data: { notified: true } });
}

async function sendProblem(shop: string, admin: Admin, settings: AppSettings, title: string, reason: string) {
  if (settings.notifyFailure !== "tell") return;
  await sendEmail({
    to: await recipient(settings, admin),
    subject: `Needs a look: ${title}`,
    html: wrap(
      `<h2 style="margin:0 0 8px">One of your scheduled articles needs a look</h2><p><strong>${esc(title)}</strong></p><p>${esc(reason)}</p><p>The schedule carries on with your next topic. <a href="${scheduleLink(shop)}">Open your schedule</a></p><p style="color:#6d7175;font-size:13px">If you'd rather not hear about these, choose "skip it and move on" in Settings under Notifications.</p>`,
    ),
  });
}

// ---------- writing and sending ----------
async function withAuthor(settings: AppSettings, shop: string, authorId: string): Promise<AppSettings> {
  const a = authorId ? await getAuthor(shop, authorId) : null;
  if (!a) return settings;
  return { ...settings, defaultAuthor: a.name, authorBio: a.bio, authorTitle: a.jobTitle, authorUrl: a.profileUrl, authorPhoto: a.photoUrl, authorVoice: a.voice };
}

async function processPost(shop: string, admin: Admin, baseSettings: AppSettings, id: string) {
  const post = await db.scheduledPost.findFirst({ where: { id, shop } });
  if (!post || post.status !== "scheduled") return;
  await db.scheduledPost.update({ where: { id }, data: { status: "writing", note: null } });
  const settings = await withAuthor(baseSettings, shop, post.authorId);
  const angle = JSON.parse(post.angle) as Angle;
  const title = angle.working_title;
  try {
    const gid = `gid://shopify/Product/${post.productId}`;
    const product = await getProduct(admin, gid);
    if (!product) throw new Error("We couldn't find the product for this topic any more.");
    const articleId = await writeArticleNow(shop, post.productId, product.facts, angle, await loadFacts(shop, post.productId), settings);
    await db.scheduledPost.update({ where: { id }, data: { articleId } });
    const art = await getArticle(shop, articleId);
    if (!art?.result || art.state !== "done") {
      await db.scheduledPost.update({ where: { id }, data: { status: "failed", note: art?.error ?? "The article couldn't be written." } });
      await sendProblem(shop, admin, settings, title, art?.error ?? "The article couldn't be written this time.");
      return;
    }
    let result = art.result;
    if (post.imageUrl) result = (await saveEdits(shop, articleId, { ...result.article, featured_image: { url: post.imageUrl, alt: post.imageAlt || result.article.h1 } })) ?? result;
    const clean = result.status === "READY FOR MERCHANT APPROVAL" && result.words >= 500;
    const live = settings.publishMode === "live" && clean;
    const { sent } = await sendToShopify(admin, {
      article: result.article,
      angle,
      productHandle: product.facts.handle,
      settings,
      shopName: settings.businessName,
      publish: live,
      publishAt: live ? post.publishAt.toISOString() : undefined,
    });
    await setSent(shop, articleId, sent);
    const held = settings.publishMode === "live" && !clean;
    await db.scheduledPost.update({
      where: { id },
      data: { status: "sent", note: held ? "Saved as a draft because it needs a quick review before it goes live." : null },
    });
    if (held) await sendProblem(shop, admin, settings, title, "It's been saved as a draft in your blog because the checks want you to review it before it goes live.");
  } catch (e) {
    console.error("Scheduled article failed", e);
    const reason = e instanceof Error && e.message ? e.message : "Something went wrong.";
    await db.scheduledPost.update({ where: { id }, data: { status: "failed", note: reason } });
    await sendProblem(shop, admin, settings, title, reason);
  }
}

/** Writes and sends every article that is due within the next day and a half. */
export async function processDue(shop: string, admin: Admin, settings: AppSettings, onlyId?: string) {
  const until = new Date(Date.now() + WRITE_WINDOW_HOURS * 3600000);
  const due = await db.scheduledPost.findMany({
    where: onlyId ? { shop, id: onlyId, status: "scheduled" } : { shop, status: "scheduled", publishAt: { lte: until } },
    orderBy: { publishAt: "asc" },
  });
  for (const p of due) await processPost(shop, admin, settings, p.id);
}

/** One full pass for a shop: fill the schedule, email the new topics, write what's due. */
export async function runShop(shop: string, admin: Admin, settings?: AppSettings) {
  const s = settings ?? (await loadEffectiveSettings(admin, shop));
  const tz = effectiveZone(s, (await shopInfo(admin)).tz);
  await topUpSchedule(shop, admin, s, tz);
  await sendDigest(shop, admin, s, tz);
  await processDue(shop, admin, s);
}

/** Called by the daily cron: every shop with the schedule switched on. */
export async function runAllShops() {
  const rows = await db.shopSettings.findMany();
  for (const r of rows as { shop: string; data: string }[]) {
    try {
      const data = JSON.parse(r.data) as Partial<AppSettings>;
      if (!data.scheduleEnabled) continue;
      const { admin } = await unauthenticated.admin(r.shop);
      await runShop(r.shop, admin as unknown as Admin);
    } catch (e) {
      console.error("Schedule run failed for", r.shop, e);
    }
  }
}

export const runInBackground = (p: Promise<unknown>) => waitUntil(p.catch((e) => console.error("Background run failed", e)));
