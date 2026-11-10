// AI Refresh, stage 2: turning what we found in one post into changes the merchant can accept or ignore. Pure code, no AI.
// Only one kind of change exists so far: taking the link off words whose link goes nowhere. The words stay.
import { DEFAULT_RULES, type RuleId } from "./refreshRules";
import { storePath, type BlogPost, type RefreshContext } from "./refresh";

const ANCHOR = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
const strip = (h: string) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const hrefOf = (anchor: string) => /\bhref\s*=\s*["']([^"']*)["']/i.exec(anchor)?.[1] ?? "";

export type LinkInfo = { index: number; href: string; text: string; start: number; end: number; rule: RuleId | null; detail: string };

/** Every link in the post, in order, with the rule (if any) that says its target has a problem. */
export function classifyLinks(html: string, ctx: RefreshContext): LinkInfo[] {
  const out: LinkInfo[] = [];
  let index = 0;
  for (const m of html.matchAll(ANCHOR)) {
    const href = hrefOf(m[0]);
    const path = storePath(href, ctx.hosts);
    let rule: RuleId | null = null;
    let detail = "";
    if (path) {
      const prod = /\/products\/([^/]+)/.exec(path);
      const coll = /^\/collections\/([^/]+)/.exec(path);
      const post = /^\/blogs\/([^/]+)\/([^/]+)/.exec(path);
      if (prod) {
        const info = ctx.products.get(decodeURIComponent(prod[1]));
        if (!info) [rule, detail] = ["dead_product", "This product no longer exists in your store."];
        else if (info.status !== "ACTIVE") [rule, detail] = ["dead_product", "This product isn't for sale (it is a draft or archived)."];
        else if (info.outOfStock) [rule, detail] = ["product_stock", "This product is out of stock right now. If that is temporary, leave the link as it is."];
      } else if (coll && !ctx.skipCollections && !ctx.collections.has(decodeURIComponent(coll[1]))) {
        [rule, detail] = ["dead_collection", "This collection no longer exists in your store."];
      } else if (post && !ctx.skipPosts && !ctx.postPaths.has(`${decodeURIComponent(post[1])}/${decodeURIComponent(post[2])}`)) {
        [rule, detail] = ["dead_post", "This post is missing or isn't published."];
      }
    }
    out.push({ index: index++, href, text: strip(m[1]), start: m.index!, end: m.index! + m[0].length, rule, detail });
  }
  return out;
}

export type Change = {
  id: string; // "link-<n>": n is the position of the link in the post
  kind: "remove_link";
  rule: RuleId;
  index: number;
  href: string;
  /** The text around the link, split so the linked words can be shown underlined. */
  pre: string;
  link: string;
  post: string;
  detail: string;
};

export type Note = { id: string; rule: RuleId; where: string; context: string; message: string };

/** The plain text of the paragraph, list item or heading around a link, split at the link. */
function around(html: string, start: number, end: number) {
  const open = [...html.slice(0, start).matchAll(/<(p|li|h[1-6]|td|blockquote)\b[^>]*>/gi)].pop();
  const from = open ? open.index! : 0;
  const closeRe = /<\/(p|li|h[1-6]|td|blockquote)>/i;
  const close = closeRe.exec(html.slice(end));
  const to = close ? end + close.index : html.length;
  let pre = strip(html.slice(from, start));
  let post = strip(html.slice(end, to));
  if (pre.length > 140) pre = "…" + pre.slice(-140);
  if (post.length > 140) post = post.slice(0, 140) + "…";
  return { pre: pre ? pre + " " : "", post: post ? " " + post : "" };
}

const PRICE_G = /(?:\$|A\$|AU\$)\s?\d[\d,]*(?:\.\d{2})?|\b\d+(?:\.\d{2})?\s?(?:AUD|USD|dollars)\b/gi;
const snippet = (text: string, at: number, len: number) => {
  const a = Math.max(0, at - 70);
  const b = Math.min(text.length, at + len + 70);
  return (a > 0 ? "…" : "") + text.slice(a, b) + (b < text.length ? "…" : "");
};

export function proposeChanges(p: BlogPost, ctx: RefreshContext): { changes: Change[]; notes: Note[] } {
  const rules = ctx.rules ?? DEFAULT_RULES;
  const changes: Change[] = [];
  const notes: Note[] = [];
  for (const l of classifyLinks(p.body, ctx)) {
    if (!l.rule) continue;
    const mode = rules[l.rule];
    if (mode === "off") continue;
    if (mode === "on" && l.rule !== "product_stock" && l.rule !== "old_year" && l.rule !== "price") {
      const { pre, post } = around(p.body, l.start, l.end);
      changes.push({ id: `link-${l.index}`, kind: "remove_link", rule: l.rule, index: l.index, href: l.href, pre, link: l.text || "(image)", post, detail: l.detail });
    } else {
      const { pre, post } = around(p.body, l.start, l.end);
      notes.push({ id: `note-link-${l.index}`, rule: l.rule, where: "Link", context: `${pre}${l.text}${post}`, message: l.detail });
    }
  }

  const year = ctx.now.getFullYear();
  if (rules.old_year !== "off") {
    const fresh = /\b(best|top|new|newest|latest|updated|guide|trends?|picks?|ideas|review)\b[^.]{0,40}\b(20[0-2]\d)\b|\b(20[0-2]\d)\b[^.]{0,20}\b(guide|review|picks|edition|update)\b/i;
    const fields: [string, string][] = [["Title", p.title], ["Search title", p.titleTag], ["Search description", p.metaDescription], ["Text", strip(p.body)]];
    const seen = new Set<string>();
    for (const [where, text] of fields) {
      for (const m of text.matchAll(/\b(20[0-2]\d)\b/g)) {
        const y = Number(m[1]);
        if (y < 2015 || y >= year) continue;
        const ctxText = snippet(text, m.index!, 4);
        if (seen.has(ctxText) || notes.filter((n) => n.rule === "old_year").length >= 6) continue;
        seen.add(ctxText);
        const claim = where !== "Text" || fresh.test(ctxText);
        notes.push({
          id: `note-year-${notes.length}`,
          rule: "old_year",
          where,
          context: ctxText,
          message: claim
            ? `Mentions ${y}. In ${where === "Text" ? "a sentence like this" : "the " + where.toLowerCase()} it can make the post look dated, so check whether it should be updated.`
            : `Mentions ${y}. This looks like history rather than a claim about now, so it is probably fine as it is.`,
        });
      }
    }
  }
  if (rules.price !== "off") {
    const text = strip(p.body);
    let n = 0;
    for (const m of text.matchAll(PRICE_G)) {
      if (n++ >= 5) break;
      notes.push({ id: `note-price-${n}`, rule: "price", where: "Text", context: snippet(text, m.index!, m[0].length), message: `Mentions ${m[0].trim()}. Check it still matches the product page.` });
    }
  }
  return { changes, notes };
}

/** A link target we are willing to write: a path on this store to a product, collection, blog post or page. */
export function safeStorePath(path: string): string | null {
  return /^\/(products|collections|blogs|pages)\/[A-Za-z0-9._~%-]+(\/[A-Za-z0-9._~%-]+)?$/.test(path) ? path : null;
}

/** Takes the link off the chosen links (by position), keeping their words, or points them somewhere else when a new address is given. A link is only touched if it still points where it did when the change was proposed. */
export function applyChanges(html: string, accepted: { index: number; href: string; newHref?: string }[]): { html: string; applied: number[] } {
  const want = new Map(accepted.map((a) => [a.index, a]));
  const applied: number[] = [];
  let i = 0;
  const out = html.replace(ANCHOR, (whole, inner: string) => {
    const idx = i++;
    const w = want.get(idx);
    if (w && hrefOf(whole) === w.href) {
      applied.push(idx);
      const to = w.newHref && safeStorePath(w.newHref);
      return to ? whole.replace(/(\bhref\s*=\s*)(["'])[^"']*\2/i, `$1"${to}"`) : inner;
    }
    return whole;
  });
  return { html: out, applied };
}
