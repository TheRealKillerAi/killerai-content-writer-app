import { renderMarkdown, tocEntries } from "./markdown";
import { tldrHtml } from "./tldr";
import type { AppSettings } from "./settings";
import type { Article } from "./pipeline/types";

export const safeHandle = (h: string, fallback: string) =>
  (h || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "article";

/** Turns [anchor](url) links into HTML anchors (rest is escaped, newlines become <br>). */
export function linkedHtml(text: string): string {
  return esc(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, a: string, u: string) => `<a href="${u}">${a}</a>`)
    .replace(/\n/g, "<br>");
}

/** Plain-text version: "anchor (url)". */
export const linkedPlain = (text: string) => text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)");

/** Turns a bare {{ARTICLE_URL}} token (older articles) into a markdown link on the words leading up to it. */
export function linkify(text: string | undefined): string | undefined {
  if (!text) return text;
  const bare = /(^|[^(])\{\{ARTICLE_URL\}\}/;
  if (!bare.test(text)) return text;
  const m = /([^.!?\n:]{3,80}?)\s*[:\u2013\u2014-]?\s*\{\{ARTICLE_URL\}\}/.exec(text.replace(/\]\(\{\{ARTICLE_URL\}\}\)/g, "]()"));
  const lead = m?.[1]?.trim().replace(/[:\u2013\u2014-]+$/, "").trim();
  if (m && lead && lead.split(/\s+/).length <= 10 && !lead.includes("[")) {
    return text.replace(new RegExp(`${lead.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:\u2013\u2014-]?\\s*\\{\\{ARTICLE_URL\\}\\}`), `[${lead}]({{ARTICLE_URL}})`);
  }
  return text.replace(/\{\{ARTICLE_URL\}\}/, "[Read the full guide]({{ARTICLE_URL}})");
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildBodyHtml(a: Article, productHandle: string, toc: boolean, settings?: Pick<AppSettings, "tldrEnabled" | "tldrLabel" | "tldrBg" | "tldrText" | "tldrCorners" | "tldrFontSize" | "tldrFont">): string {
  const productUrl = `/products/${productHandle}`;
  const parts: string[] = [];
  if (!settings || settings.tldrEnabled) parts.push(settings ? tldrHtml(a.tldr, settings) : `<p><strong>TL;DR:</strong> ${esc(a.tldr)}</p>`);
  const entries = toc ? tocEntries(a.body_markdown) : [];
  if (entries.length >= 3) {
    parts.push(
      `<p><strong>In this article</strong></p>\n<ul>${entries
        .map((e) => `<li><a href="#${e.id}">${esc(e.text)}</a></li>`)
        .join("")}</ul>`,
    );
  }
  parts.push(renderMarkdown(a.body_markdown, productUrl, entries.length >= 3));
  if (a.faq.length) {
    parts.push(
      `<h2>Frequently asked questions</h2>`,
      ...a.faq.map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`),
    );
  }
  return parts.join("\n");
}

