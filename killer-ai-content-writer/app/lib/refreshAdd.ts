// AI Refresh, stage 3: adding what an old post is missing (a TL;DR, an FAQ, links to your own pages). Pure code shared by server and screen.
import { addInternalLinks, type LinkTargets } from "./pipeline/links";
import { tldrHtml, type TldrStyle } from "./tldr";
import type { BlogPost } from "./refresh";
import type { Change } from "./refreshChanges";

const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hash = (t: string) => {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

export type Addition =
  | { id: string; kind: "tldr"; text: string }
  | { id: string; kind: "faq"; items: { q: string; a: string }[] };

export const ADD_TLDR_ID = "add-tldr";
export const ADD_FAQ_ID = "add-faq";

/** The blocks of a post in order. A paragraph with nothing but text in it is safe to put a link into. */
function blocks(html: string) {
  const out: { type: "h" | "p"; ordinal: number; inner: string; plain: boolean; text: string }[] = [];
  let p = 0;
  for (const m of html.matchAll(/<(p|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const isP = m[1].toLowerCase() === "p";
    out.push({ type: isP ? "p" : "h", ordinal: isP ? p++ : -1, inner: m[2], plain: !m[2].includes("<"), text: strip(m[2]) });
  }
  return out;
}

/** Links the post could have to the store's collections and other posts, found by code from words already in the text. */
export function proposeLinkAdds(post: BlogPost, targets: LinkTargets): Change[] {
  const bl = blocks(post.body);
  // Headings keep their markdown marker so they are never linked; paragraphs with tags or existing links are shown as empty so they are left alone.
  const md = bl.map((b) => (b.type === "h" ? `## ${b.text}` : b.plain && b.text ? b.inner : "")).join("\n");
  const self = `/blogs/${post.blogHandle}/${post.handle}`;
  const t: LinkTargets = { ...targets, articles: targets.articles.filter((a) => a.path !== self), selfKeyword: post.title };
  const res = addInternalLinks(md, t, { collections: true, articles: true }, post.title, "");
  const lines = res.md.split("\n");
  const out: Change[] = [];
  lines.forEach((line, i) => {
    const m = /\[([^\]]+)\]\(([^)]+)\)/.exec(line);
    if (!m || bl[i].type !== "p") return;
    const at = line.indexOf(m[0]);
    const pre = strip(line.slice(0, at));
    const post_ = strip(line.slice(at + m[0].length));
    out.push({
      id: `add-link-${bl[i].ordinal}-${hash(m[2])}`,
      kind: "add_link",
      rule: "add_links",
      index: bl[i].ordinal,
      href: m[2],
      pre: pre ? (pre.length > 140 ? "…" + pre.slice(-140) : pre) + " " : "",
      link: m[1],
      post: post_ ? " " + (post_.length > 140 ? post_.slice(0, 140) + "…" : post_) : "",
      detail: m[2].startsWith("/collections/") ? "These words match one of your collections." : "These words match another post on your blog.",
    });
  });
  return out;
}

/** Puts the chosen links in. A paragraph is only touched if it is still plain text and still holds the words. */
export function applyLinkAdds(html: string, adds: { index: number; link: string; href: string }[]): { html: string; applied: number[] } {
  const want = new Map(adds.map((a) => [a.index, a]));
  const applied: number[] = [];
  let p = 0;
  const out = html.replace(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi, (whole, attrs: string, inner: string) => {
    const idx = p++;
    const a = want.get(idx);
    if (!a || inner.includes("<") || !/^\/(collections|blogs)\/[A-Za-z0-9._~%/-]+$/.test(a.href)) return whole;
    const at = inner.indexOf(a.link);
    if (at < 0) return whole;
    applied.push(idx);
    return `<p${attrs}>${inner.slice(0, at)}<a href="${a.href}">${a.link}</a>${inner.slice(at + a.link.length)}</p>`;
  });
  return { html: out, applied };
}

export const faqHtml = (items: { q: string; a: string }[]) => `<h2>Frequently asked questions</h2>\n${items.map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`).join("\n")}`;

/** A TL;DR goes at the very top and an FAQ at the end, just above the author box when there is one. */
export function applyAdditions(html: string, adds: Addition[], style: TldrStyle): string {
  let out = html;
  for (const a of adds) {
    if (a.kind === "tldr") out = tldrHtml(a.text, style) + "\n" + out;
    else {
      const box = out.search(/<div style="display:flex;gap:16px;align-items:flex-start;margin-top:32px/);
      out = box >= 0 ? out.slice(0, box) + faqHtml(a.items) + "\n" + out.slice(box) : out + "\n" + faqHtml(a.items);
    }
  }
  return out;
}
