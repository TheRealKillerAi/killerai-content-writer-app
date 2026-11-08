import { renderMarkdown, tocEntries } from "./markdown";
import { tldrHtml } from "./tldr";
import type { AppSettings } from "./settings";
import type { Article } from "./pipeline/types";

export const safeHandle = (h: string, fallback: string) =>
  (h || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "article";

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

