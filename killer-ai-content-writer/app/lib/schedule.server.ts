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
import { findGuideAngles } from "./pipeline/guide.server";
import { guideKey, parseGuideKey } from "./guide";
import { sendToShopify } from "./publish.server";
import { existingArticleTitles, getProduct, gql, listProducts, productImages, type Admin } from "./products.server";
import { loadEffectiveSettings, validZone } from "./settings.server";
import type { AppSettings } from "./settings";
import type { Angle } from "./pipeline/types";

/** How long before publishing the article is written. */
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

/** Publish times the schedule calls for within the planning window (7, 14 or 30 days). */
export function upcomingSlots(s: AppSettings, tz: string, now = new Date()): Date[] {
  const days = new Set(s.scheduleDays.split(",").map(Number));
  const [hh, mm] = s.scheduleTime.split(":").map(Number);
  const { y, m, d } = localDate(now, tz);
  const out: Date[] = [];
  const horizon = s.planDays || 7;
  for (let i = 0; i <= horizon + 1; i++) {
    const day = new Date(Date.UTC(y, m - 1, d) + i * 86400000);
    if (!days.has(day.getUTCDay())) continue;
    const at = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, tz);
    if (at.getTime() > now.getTime() + 3600000 && at.getTime() <= now.getTime() + horizon * 86400000) out.push(at);
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

type Candidate = { key: string; kind: "product" | "guide"; ids: string[]; title: string };
const numeric = (gid: string) => gid.split("/").pop()!;
const MIN_GAP_DAYS = 3; // the same product or guide is never scheduled twice within this many days

async function setNote(shop: string, note: string) {
  await db.scheduleStatus.upsert({ where: { shop }, create: { shop, note }, update: { note } });
}

async function setWorking(shop: string, working: boolean) {
  await db.scheduleStatus.upsert({ where: { shop }, create: { shop, working }, update: { working } });
}

/** True while topics are still being found in the background (a flag older than 15 minutes is ignored). */
export async function isWorking(shop: string): Promise<boolean> {
  const r = await db.scheduleStatus.findUnique({ where: { shop } });
  return !!r?.working && Date.now() - r.updatedAt.getTime() < 15 * 60 * 1000;
}

const WORK_BUDGET_MS = 230000; // stop and hand over to a fresh run before the hosting time limit
const MAX_CHAIN = 8;

/** Adds topics for any upcoming publish slot that doesn't have one yet. Topics only: the article is written later. */
export async function topUpSchedule(shop: string, admin: Admin, settings: AppSettings, tz: string, force = false, deadline = 0): Promise<{ created: number; more: boolean }> {
  const now = new Date();
  const existing = await db.scheduledPost.findMany({ where: { shop, publishAt: { gte: now } } });
  // "Plan the next batch when N days are left": wait until the schedule is about to run out, then fill the whole window again.
  if (!force && settings.refillDays > 0 && existing.length) {
    const last = Math.max(...existing.map((e: { publishAt: Date }) => e.publishAt.getTime()));
    if ((last - now.getTime()) / 86400000 > settings.refillDays) return { created: 0, more: false };
  }
  const have = new Set(existing.map((e: { publishAt: Date }) => e.publishAt.getTime()));
  const missing = upcomingSlots(settings, tz, now).filter((s) => !have.has(s.getTime()));
  if (!missing.length) {
    await setNote(shop, "");
    return { created: 0, more: false };
  }

  // Products, least recently used first.
  const rows: { id: string; title: string; type: string }[] = [];
  let after: string | null = null;
  for (let i = 0; i < 3; i++) {
    const page = await listProducts(admin, "status:active", after);
    rows.push(...page.products.map((p) => ({ id: p.id, title: p.title, type: (p.productType || "").trim() })));
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  const lastUsed = new Map<string, number>();
  for (const a of await db.article.findMany({ where: { shop }, select: { productId: true, createdAt: true } }))
    lastUsed.set(a.productId, Math.max(lastUsed.get(a.productId) ?? 0, a.createdAt.getTime()));
  for (const e of await db.scheduledPost.findMany({ where: { shop }, select: { productId: true, publishAt: true } }))
    lastUsed.set(e.productId, Math.max(lastUsed.get(e.productId) ?? 0, e.publishAt.getTime()));
  const order = rows.sort((a, b) => (lastUsed.get(numeric(a.id)) ?? 0) - (lastUsed.get(numeric(b.id)) ?? 0));

  const products: Candidate[] = order.map((p) => ({ key: numeric(p.id), kind: "product", ids: [numeric(p.id)], title: p.title }));
  const guides: Candidate[] = [];
  if (settings.mixGuides) {
    const byType = new Map<string, typeof order>();
    for (const p of order) if (p.type) byType.set(p.type, [...(byType.get(p.type) ?? []), p]);
    for (const [type, list] of byType) {
      if (list.length < 2) continue;
      const pick = list.slice(0, 4);
      const ids = pick.map((p) => numeric(p.id));
      guides.push({ key: guideKey(ids), kind: "guide", ids, title: `Buying guide: ${type}` });
    }
  }

  const taken = new Set<string>();
  for (const e of existing) {
    const a = JSON.parse(e.angle) as Angle;
    taken.add(key(a.working_title));
    taken.add(key(a.target_query));
  }
  const covered = await coveredTopics(shop);
  const lastSlot = new Map<string, number>(); // candidate key -> latest scheduled publish time
  for (const e of existing) lastSlot.set(e.productId, Math.max(lastSlot.get(e.productId) ?? 0, e.publishAt.getTime()));
  const exhausted = new Set<string>(); // candidates with no topic that can be written right now
  const usedThisRun = new Set<string>();
  const gap = MIN_GAP_DAYS * 86400000;

  const evaluate = async (c: Candidate) => {
    if (c.kind === "product") {
      const product = await getProduct(admin, `gid://shopify/Product/${c.ids[0]}`);
      if (!product) return null;
      const facts = await loadFacts(shop, c.ids[0]);
      let angles = await loadAngles(shop, c.key);
      let angle = pickAngle(angles, taken, covered);
      if (!angle) {
        try {
          const titles = [...(await existingArticleTitles(admin)), ...angles.map((a) => a.working_title), ...covered.flatMap((x) => [x.title, x.keyword].filter((t): t is string => !!t))];
          const { angles: fresh } = await findAngles(product.facts, titles, facts.known, settings);
          const seen = new Set(angles.flatMap((a) => [key(a.working_title), key(a.target_query)]));
          angles = [...angles, ...fresh.filter((a) => !seen.has(key(a.working_title)) && !seen.has(key(a.target_query)))].slice(0, 30);
          await saveAngles(shop, c.key, angles);
          angle = pickAngle(angles, taken, covered);
        } catch (e) {
          console.error("Topic search failed", e);
        }
      }
      return angle ? { angle, title: c.title } : null;
    }
    const prods = (await Promise.all(c.ids.map((id) => getProduct(admin, `gid://shopify/Product/${id}`)))).flatMap((p, i) => (p ? [{ ...p, id: c.ids[i] }] : []));
    if (prods.length < 2) return null;
    const factsByHandle: Record<string, Awaited<ReturnType<typeof loadFacts>>> = {};
    for (const p of prods) factsByHandle[p.facts.handle] = await loadFacts(shop, p.id);
    let angles = await loadAngles(shop, c.key);
    let angle = pickAngle(angles, taken, covered);
    if (!angle) {
      try {
        const titles = [...(await existingArticleTitles(admin)), ...angles.map((a) => a.working_title), ...covered.flatMap((x) => [x.title, x.keyword].filter((t): t is string => !!t))];
        const fresh = await findGuideAngles(prods.map((p) => p.facts), titles, factsByHandle, settings);
        const seen = new Set(angles.flatMap((a) => [key(a.working_title), key(a.target_query)]));
        angles = [...angles, ...fresh.filter((a) => !seen.has(key(a.working_title)) && !seen.has(key(a.target_query)))].slice(0, 30);
        await saveAngles(shop, c.key, angles);
        angle = pickAngle(angles, taken, covered);
      } catch (e) {
        console.error("Guide topic search failed", e);
      }
    }
    return angle ? { angle, title: `Buying guide: ${prods.map((p) => p.facts.title).slice(0, 3).join(", ")}${prods.length > 3 ? " and more" : ""}` } : null;
  };

  let created = 0;
  let index = 0;
  let more = false;
  for (const slot of missing) {
    if (deadline && Date.now() > deadline) {
      more = true;
      break;
    }
    // With both kinds ticked, every third article is a buying guide.
    const guideTurn = settings.mixGuides && (!settings.mixProduct || index % 3 === 2);
    const lists = guideTurn ? [guides, settings.mixProduct ? products : []] : [settings.mixProduct ? products : [], guides];
    let placed = false;
    for (const list of lists) {
      for (const pass of [1, 2]) {
        if (placed) break;
        for (const c of list) {
          if (placed) break;
          if (exhausted.has(c.key)) continue;
          const used = usedThisRun.has(c.key);
          if (pass === 1 && used) continue;
          if (pass === 2 && !used) continue;
          const near = Math.abs(slot.getTime() - (lastSlot.get(c.key) ?? -Infinity)) < gap;
          if (near) continue;
          const found = await evaluate(c);
          if (!found) {
            exhausted.add(c.key);
            continue;
          }
          const image = settings.scheduleImage === "product" ? (await productImages(admin, `gid://shopify/Product/${c.ids[0]}`))[0] : undefined;
          await db.scheduledPost.create({
            data: {
              shop,
              productId: c.key,
              productTitle: found.title,
              angle: JSON.stringify(found.angle),
              publishAt: slot,
              authorId: settings.defaultAuthorId,
              imageUrl: image?.url ?? "",
              imageAlt: image?.alt || found.title,
            },
          });
          taken.add(key(found.angle.working_title));
          taken.add(key(found.angle.target_query));
          usedThisRun.add(c.key);
          lastSlot.set(c.key, slot.getTime());
          created++;
          placed = true;
        }
      }
      if (placed) break;
    }
    index++;
  }

  if (more) return { created, more: true };

  // Say plainly why any day couldn't be filled.
  if (created < missing.length) {
    const total = (settings.mixProduct ? products.length : 0) + guides.length;
    const parts = [`Filled ${created} of ${missing.length} open days.`];
    if (!settings.mixProduct && !guides.length) parts.push("There are no buying guides to write yet: guides need at least two products of the same type.");
    else if (!total) parts.push("There are no active products to write about.");
    else if (exhausted.size >= total) parts.push(`Every product${guides.length ? " and guide" : ""} has already been used or has no new topic we can write from the facts we have.`);
    else parts.push("The remaining products were scheduled recently, so we spaced them out to avoid repeating a product within three days.");
    parts.push(settings.mixGuides ? "Adding details to your products will unlock more topics." : "Adding details to your products, or turning on buying guides in Settings, will unlock more topics.");
    await setNote(shop, parts.join(" "));
  } else {
    await setNote(shop, "");
  }
  return { created, more: false };
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

export type DigestStatus = { status: "off" | "nothing-new" | "sent" | "failed"; count: number; to: string };

async function sendDigest(shop: string, admin: Admin, settings: AppSettings, tz: string): Promise<DigestStatus> {
  if (settings.notifyUpcoming !== "weekly") return { status: "off", count: 0, to: "" };
  const fresh = await db.scheduledPost.findMany({ where: { shop, notified: false, status: "scheduled", publishAt: { gte: new Date() } }, orderBy: { publishAt: "asc" } });
  if (!fresh.length) return { status: "nothing-new", count: 0, to: "" };
  const items = fresh
    .map((p: { id: string; publishAt: Date; imageUrl: string; imageAlt: string; angle: string; productTitle: string }) => {
      const a = JSON.parse(p.angle) as Angle;
      const img = p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.imageAlt)}" width="72" height="72" style="border-radius:6px;object-fit:cover;display:block">` : "";
      return `<tr><td style="padding:10px 12px 10px 0;vertical-align:top">${img}</td><td style="padding:10px 0;vertical-align:top;border-bottom:1px solid #e1e3e5"><strong>${esc(a.working_title)}</strong><br><span style="color:#6d7175">${esc(p.productTitle)} · ${esc(when(p.publishAt, tz))}</span></td></tr>`;
    })
    .join("");
  const to = await recipient(settings, admin);
  const status = await db.scheduleStatus.findUnique({ where: { shop } });
  const ok = await sendEmail({
    to,
    subject: `Your upcoming articles: ${fresh.length} scheduled`,
    html: wrap(
      `<h2 style="margin:0 0 8px">Your upcoming articles</h2><p>These topics are scheduled. Each article is written about a day before it goes out, so there's time to change a topic or picture, or remove one you don't want.</p>${status?.note ? `<p style="background:#fff5ea;border-radius:8px;padding:10px 12px">${esc(status.note)}</p>` : ""}<table style="width:100%;border-collapse:collapse">${items}</table><p><a href="${scheduleLink(shop)}" style="display:inline-block;background:#303030;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Review your schedule</a></p><p style="color:#6d7175;font-size:13px">You can switch these emails off in Settings under Notifications.</p>`,
    ),
  });
  if (ok) await db.scheduledPost.updateMany({ where: { id: { in: fresh.map((f: { id: string }) => f.id) } }, data: { notified: true } });
  return { status: ok ? "sent" : "failed", count: fresh.length, to };
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
    const guideIds = parseGuideKey(post.productId);
    let product: Awaited<ReturnType<typeof getProduct>>;
    let articleId: string;
    if (guideIds) {
      const found = (await Promise.all(guideIds.map((pid) => getProduct(admin, `gid://shopify/Product/${pid}`)))).flatMap((p, i) => (p ? [{ ...p, id: guideIds[i] }] : []));
      if (found.length < 2) throw new Error("We couldn't find enough of the products for this buying guide any more.");
      product = found[0];
      const merchant: { known: Record<string, string>; unknown: string[] } = { known: {}, unknown: [] };
      for (const p of found) {
        const f = await loadFacts(shop, p.id);
        for (const [q, a] of Object.entries(f.known)) merchant.known[`${p.facts.title}: ${q}`] = a;
        for (const q of f.unknown) merchant.unknown.push(`${p.facts.title}: ${q}`);
      }
      articleId = await writeArticleNow(shop, post.productId, found[0].facts, angle, merchant, settings, found.map((p) => p.facts), admin);
    } else {
      product = await getProduct(admin, `gid://shopify/Product/${post.productId}`);
      if (!product) throw new Error("We couldn't find the product for this topic any more.");
      articleId = await writeArticleNow(shop, post.productId, product.facts, angle, await loadFacts(shop, post.productId), settings, undefined, admin);
    }
    if (!product) throw new Error("We couldn't find the product for this topic any more.");
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

async function continueLater(shop: string, chain: number, force: boolean, write: boolean) {
  // eslint-disable-next-line no-undef
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  // eslint-disable-next-line no-undef
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) throw new Error("Can't continue: SHOPIFY_APP_URL or CRON_SECRET is missing.");
  const res = await fetch(`${base}/cron/continue`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ shop, chain, force, write }),
  });
  if (!res.ok) throw new Error(`Continue request failed (${res.status})`);
}

/**
 * Finds topics and emails them. Runs for up to a few minutes, then hands over to a fresh run so a long plan
 * (for example 30 days) keeps going in the background without the merchant staying on the page.
 */
export async function fillChain(shop: string, admin: Admin, settings: AppSettings, tz: string, opts: { force?: boolean; write?: boolean; chain?: number } = {}): Promise<DigestStatus> {
  const chain = opts.chain ?? 0;
  const { more } = await topUpSchedule(shop, admin, settings, tz, !!opts.force, Date.now() + WORK_BUDGET_MS);
  if (more && chain < MAX_CHAIN) {
    try {
      await setWorking(shop, true);
      await continueLater(shop, chain + 1, !!opts.force, !!opts.write);
      return { status: "nothing-new", count: 0, to: "" };
    } catch (e) {
      console.error("Couldn't continue the schedule run", e);
    }
  }
  await setWorking(shop, false);
  if (more) await setNote(shop, "Some days were left empty because the run took too long. Press Find topics now to carry on.");
  const d = await sendDigest(shop, admin, settings, tz);
  if (opts.write) await processDue(shop, admin, settings);
  return d;
}

/** How many publish slots in the next week don't have a topic yet. */
export async function openSlotCount(shop: string, settings: AppSettings, tz: string): Promise<number> {
  const existing = await db.scheduledPost.findMany({ where: { shop, publishAt: { gte: new Date() } }, select: { publishAt: true } });
  const have = new Set(existing.map((e: { publishAt: Date }) => e.publishAt.getTime()));
  return upcomingSlots(settings, tz).filter((s) => !have.has(s.getTime())).length;
}

export async function sendTopicsEmail(shop: string, admin: Admin, settings: AppSettings, tz: string) {
  return sendDigest(shop, admin, settings, tz);
}

/** One full pass for a shop: fill the schedule, email the new topics, write what's due. */
export async function runShop(shop: string, admin: Admin, settings?: AppSettings) {
  const s = settings ?? (await loadEffectiveSettings(admin, shop));
  const tz = effectiveZone(s, (await shopInfo(admin)).tz);
  await fillChain(shop, admin, s, tz, { write: true });
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
