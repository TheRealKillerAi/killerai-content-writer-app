// Refresh mode, stage 1: spotting posts that look out of date. Pure code, no AI, nothing is changed in Shopify.
import { scoreArticle } from "./score";
import type { Article } from "./pipeline/types";

export type BlogPost = {
  id: string;
  title: string;
  handle: string;
  blogHandle: string;
  blogTitle: string;
  body: string;
  summary: string;
  isPublished: boolean;
  publishedAt: string | null;
  updatedAt: string;
  author: string;
  image: { url: string; altText: string | null } | null;
  titleTag: string;
  metaDescription: string;
};

export type Signal = { id: string; label: string; weight: number };

export type RefreshContext = {
  /** Status of each product handle the posts link to; missing handles are absent from the map. */
  products: Map<string, { status: string; outOfStock: boolean }>;
  collections: Set<string>;
  /** Paths ("blog/handle") of every published post on the store. */
  postPaths: Set<string>;
  /** Hosts that count as this store (primary domain, myshopify domain). */
  hosts: Set<string>;
  now: Date;
};

export type PostReview = {
  post: BlogPost;
  ageMonths: number;
  words: number;
  signals: Signal[];
  priority: number;
  seo: number;
  ai: { passed: number; total: number };
};

const strip = (h: string) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

export function hrefsOf(html: string): string[] {
  return [...html.matchAll(/<a\s[^>]*href=["']([^"']*)["']/gi)].map((m) => m[1]);
}

/** The path of a link when it points at this store (relative, or on one of the store's own hosts). */
export function storePath(href: string, hosts: Set<string>): string | null {
  const h = href.trim();
  if (h.startsWith("/") && !h.startsWith("//")) return h.split(/[?#]/)[0];
  const m = /^https?:\/\/([^/]+)(\/[^?#]*)?/i.exec(h);
  if (m && hosts.has(m[1].toLowerCase())) return m[2] ?? "/";
  return null;
}

export function productHandlesIn(html: string, hosts: Set<string>): string[] {
  const out = new Set<string>();
  for (const href of hrefsOf(html)) {
    const p = storePath(href, hosts);
    const m = p && /\/products\/([^/]+)/.exec(p);
    if (m) out.add(decodeURIComponent(m[1]));
  }
  return [...out];
}

/** Turns an existing blog post into the shape the article scorer expects. Keyword-based checks are left out later because we don't know the post's search phrase. */
function toArticle(p: BlogPost): Article {
  const html = p.body;
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => strip(m[1])).filter(Boolean);
  const first = paras[0] ?? "";
  const tldr = /^(tl;?dr|key takeaways?|in short|quick answer|the short answer)\b/i.test(first) ? first.replace(/^(tl;?dr|key takeaways?|in short|quick answer|the short answer)\s*[:\-–—]?\s*/i, "") : "";
  const faqAt = html.search(/<h[2-4][^>]*>[^<]*(frequently asked|faq)/i);
  const faq: { q: string; a: string }[] = [];
  if (faqAt >= 0) {
    for (const m of html.slice(faqAt).matchAll(/<h[3-4][^>]*>([\s\S]*?)<\/h[3-4]>\s*(?:<p[^>]*>([\s\S]*?)<\/p>)?/gi)) faq.push({ q: strip(m[1]), a: strip(m[2] ?? "") });
  }
  return {
    h1: p.title,
    title_tag: p.titleTag || p.title,
    meta_description: p.metaDescription,
    handle: p.handle,
    tldr,
    excerpt: strip(p.summary),
    body_markdown: "",
    faq,
    featured_image: p.image ? { url: p.image.url, alt: p.image.altText ?? "" } : undefined,
  } as unknown as Article;
}

const KEYWORD_CHECKS = new Set(["kwTitle", "kwH1", "kwIntro", "handle"]);

export function scoreExisting(p: BlogPost, hosts: Set<string>) {
  const art = toArticle(p);
  const handles = productHandlesIn(p.body, hosts);
  const s = scoreArticle(art, { html: p.body, keyword: p.title, productHandle: handles[0] ?? "", author: p.author });
  const checks = s.seo.checks.filter((c) => !KEYWORD_CHECKS.has(c.id));
  const total = checks.reduce((n, c) => n + c.weight, 0);
  const got = checks.filter((c) => c.pass).reduce((n, c) => n + c.weight, 0);
  return { words: s.words, seo: Math.round((got / total) * 100), ai: { passed: s.ai.passed, total: s.ai.total }, seoChecks: checks, aiChecks: s.ai.checks };
}

export function analysePost(p: BlogPost, ctx: RefreshContext): PostReview {
  const text = strip(p.body);
  const signals: Signal[] = [];
  const add = (id: string, label: string, weight: number) => signals.push({ id, label, weight });
  const year = ctx.now.getFullYear();

  // Products and collections the post links to
  const hrefs = hrefsOf(p.body);
  const paths = hrefs.map((h) => storePath(h, ctx.hosts)).filter((x): x is string => !!x);
  const gone: string[] = [];
  const unavailable: string[] = [];
  const outOfStock: string[] = [];
  for (const h of productHandlesIn(p.body, ctx.hosts)) {
    const info = ctx.products.get(h);
    if (!info) gone.push(h);
    else if (info.status !== "ACTIVE") unavailable.push(h);
    else if (info.outOfStock) outOfStock.push(h);
  }
  if (gone.length) add("product_gone", `Links to ${gone.length === 1 ? "a product that no longer exists" : `${gone.length} products that no longer exist`}`, 5);
  if (unavailable.length) add("product_unavailable", `Links to ${unavailable.length === 1 ? "a product that isn't for sale" : `${unavailable.length} products that aren't for sale`} (draft or archived)`, 4);
  if (outOfStock.length) add("product_stock", `Links to ${outOfStock.length === 1 ? "a product that is out of stock" : `${outOfStock.length} products that are out of stock`}`, 2);
  const deadCollections = new Set<string>();
  const deadPosts = new Set<string>();
  for (const path of paths) {
    const c = /^\/collections\/([^/]+)/.exec(path);
    if (c && !ctx.collections.has(decodeURIComponent(c[1]))) deadCollections.add(c[1]);
    const b = /^\/blogs\/([^/]+)\/([^/]+)/.exec(path);
    if (b && !ctx.postPaths.has(`${decodeURIComponent(b[1])}/${decodeURIComponent(b[2])}`)) deadPosts.add(path);
  }
  if (deadCollections.size) add("collection_gone", `Links to ${deadCollections.size === 1 ? "a collection that no longer exists" : `${deadCollections.size} collections that no longer exist`}`, 4);
  if (deadPosts.size) add("post_gone", `Links to ${deadPosts.size === 1 ? "a post that is missing or unpublished" : `${deadPosts.size} posts that are missing or unpublished`}`, 4);

  // Years and prices
  const oldYears = [...new Set([...`${p.title} ${p.titleTag} ${p.metaDescription} ${text}`.matchAll(/\b(20[0-2]\d)\b/g)].map((m) => Number(m[1])).filter((y) => y >= 2015 && y < year))].sort();
  if (oldYears.length) add("old_year", `Mentions ${oldYears.length === 1 ? "a past year" : "past years"}: ${oldYears.join(", ")}`, 3);
  if (/(?:\$|A\$|AU\$)\s?\d|\b\d+(?:\.\d{2})?\s?(?:AUD|USD|dollars)\b/i.test(text)) add("price", "Mentions a price, which may have changed", 3);

  // What's missing
  const sc = scoreExisting(p, ctx.hosts);
  if (sc.words < 500) add("thin", `Short (${sc.words} words)`, 2);
  if (!/^\s*(<[^>]+>\s*)*(<p[^>]*>)?\s*(<strong>|<b>)?\s*(tl;?dr|key takeaways?|in short|quick answer|the short answer)/i.test(p.body.slice(0, 600))) add("no_tldr", "No TL;DR at the top", 1);
  if (!/frequently asked|\bFAQ/i.test(text)) add("no_faq", "No FAQ", 1);
  if (!paths.some((x) => /^\/(collections|blogs)\//.test(x))) add("no_links", "No links to your collections or other posts", 1);
  if (!paths.some((x) => x.startsWith("/products/"))) add("no_product", "Doesn't link to a product", 1);

  const updated = new Date(p.updatedAt);
  const ageMonths = Math.max(0, Math.round((ctx.now.getTime() - updated.getTime()) / (30.44 * 86400000)));
  const ageWeight = ageMonths >= 24 ? 6 : ageMonths >= 12 ? 4 : ageMonths >= 6 ? 2 : 0;
  const priority = ageWeight + signals.reduce((n, s) => n + s.weight, 0) + (paths.some((x) => x.startsWith("/products/")) ? 1 : 0);
  return { post: p, ageMonths, words: sc.words, signals, priority, seo: sc.seo, ai: sc.ai };
}

export function ageLabel(months: number): string {
  if (months < 1) return "This month";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${y} year${y === 1 ? "" : "s"}${m ? ` ${m} mo` : ""} ago`;
}
