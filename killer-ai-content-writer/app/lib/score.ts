import type { Article } from "./pipeline/types";

export type Check = { id: string; label: string; pass: boolean; hint: string; weight: number };
export type Score = {
  /** Words in the article a reader sees (TL;DR, body and FAQ), the same count the length check uses. */
  words: number;
  seo: { score: number; checks: Check[] };
  ai: { passed: number; total: number; checks: Check[] };
};

const STOP = new Set("a an the to of for and or in on at by from with how what why when where which who is are be can do does your you it its this that as vs best my we i".split(" "));
const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|ly|s)$/, "") : w);
const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const tokens = (k: string) => k.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
/** True when most of the important words of the keyword appear (word forms like switch/switching count). Long keywords can't always fit whole in a 60 character title. */
const hasKeyword = (text: string, keyword: string) => {
  const t = tokens(keyword).map(stem);
  if (!t.length) return true;
  const have = new Set(tokens(text).map(stem));
  return t.filter((w) => have.has(w)).length / t.length >= 0.75;
};

const VAGUE_LINK = /^(click here|here|read more|more|learn more|this|this link|link|click|see more)$/i;

/**
 * Scores the finished article HTML plus its search fields.
 * The SEO score is modelled on the Lighthouse SEO audits that an article can influence (title, description,
 * descriptive links, crawlable links, image alt text), plus on-page checks Lighthouse leaves out.
 * "AI readiness" counts how many answer-engine checks pass, in the spirit of Lighthouse's Agentic Browsing count.
 */
export function scoreArticle(
  a: Article,
  ctx: { html: string; keyword: string; productHandle: string; author: string },
): Score {
  const html = ctx.html;
  const text = strip(html);
  const headings = [...html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ level: Number(m[1]), text: strip(m[2]) }));
  const links = [...html.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({ href: m[1], text: strip(m[2]) }));
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => strip(m[1])).filter(Boolean);
  const h2 = headings.filter((h) => h.level === 2 && !/^in this article$/i.test(h.text));
  const title = a.title_tag?.trim() ?? "";
  const meta = a.meta_description?.trim() ?? "";
  const firstPara = a.tldr?.trim() || paras[0] || "";
  const img = a.featured_image;
  const bodyImgsMissingAlt = imgs.filter((i) => !/\balt="[^"]+"/i.test(i)).length;
  const skipped = headings.some((h, i) => i > 0 && h.level > headings[i - 1].level + 1);
  const productHrefs = new Set(links.filter((l) => l.href.includes("/products/")).map((l) => l.href));
  const productLinked = a.guide ? productHrefs.size >= 2 : links.some((l) => l.href.includes(`/products/${ctx.productHandle}`));
  const kw = ctx.keyword;

  const seo: Check[] = [
    { id: "title", weight: 3, label: "Search title is the right length", pass: title.length >= 30 && title.length <= 60, hint: `Aim for 30–60 characters (now ${title.length}).` },
    { id: "meta", weight: 3, label: "Search description is the right length", pass: meta.length >= 70 && meta.length <= 160, hint: `Aim for 70–160 characters (now ${meta.length}).` },
    { id: "kwTitle", weight: 2, label: "Main keyword is in the search title", pass: hasKeyword(title, kw), hint: `Work "${kw}" into the search title.` },
    { id: "kwH1", weight: 2, label: "Main keyword is in the heading", pass: hasKeyword(a.h1 ?? "", kw), hint: `Work "${kw}" into the main heading.` },
    { id: "kwIntro", weight: 1, label: "Main keyword is in the opening", pass: hasKeyword(firstPara, kw), hint: `Mention "${kw}" in the TL;DR or first paragraph.` },
    { id: "image", weight: 2, label: "Featured image with a description", pass: !!img?.url && !!img.alt?.trim(), hint: img?.url ? "Add a short image description (alt text)." : "Choose a featured image." },
    { id: "alt", weight: 1, label: "Every image in the article has alt text", pass: bodyImgsMissingAlt === 0, hint: `${bodyImgsMissingAlt} image(s) in the body have no alt text.` },
    { id: "linkText", weight: 2, label: "Links have descriptive text", pass: links.every((l) => !VAGUE_LINK.test(l.text)), hint: 'Avoid link text like "click here" or "read more".' },
    { id: "crawl", weight: 1, label: "Links can be followed by search engines", pass: links.every((l) => l.href.trim() !== "" && l.href.trim() !== "#" && !/^javascript:/i.test(l.href)), hint: "Some links have an empty or invalid address." },
    { id: "headings", weight: 2, label: "Headings are in a sensible order", pass: !skipped && headings.filter((h) => h.level === 1).length === 0, hint: "Don't skip heading levels (like H2 straight to H4), and keep H1 for the title." },
    { id: "sections", weight: 1, label: "Broken into at least 3 sections", pass: h2.length >= 3, hint: "Add more H2 headings so readers can skim." },
    { id: "length", weight: 1, label: "Enough depth (500+ words)", pass: words(text) >= 500, hint: `The article is ${words(text)} words.` },
    { id: "product", weight: 2, label: "Links to the product page", pass: productLinked, hint: "Link to your product from the body." },
    { id: "handle", weight: 1, label: "Short, readable URL handle", pass: !!a.handle && a.handle.length <= 60 && /^[a-z0-9-]+$/.test(a.handle) && hasKeyword(a.handle.replace(/-/g, " "), kw.split(" ").slice(0, 2).join(" ")), hint: "Keep the handle under 60 characters with plain words and your keyword." },
    { id: "excerpt", weight: 1, label: "Excerpt written for the blog listing", pass: !!a.excerpt?.trim(), hint: "Add an excerpt." },
  ];
  const totalW = seo.reduce((s, c) => s + c.weight, 0);
  const gotW = seo.filter((c) => c.pass).reduce((s, c) => s + c.weight, 0);

  const longPara = paras.some((p) => words(p) > 120);
  const questionHeads = headings.filter((h) => h.text.endsWith("?")).length + a.faq.filter((f) => f.q.trim().endsWith("?")).length;
  const numbers = (text.match(/\b\d+(\.\d+)?\s?(kg|g|ml|l|cm|mm|%|°c|c|degrees|months?|weeks?|days?|years?|uses?|loads?)\b|\b\d{2,}\b/gi) ?? []).length;
  const ai: Check[] = [
    { id: "tldr", weight: 1, label: "Starts with a short answer-first summary", pass: words(a.tldr ?? "") >= 15 && words(a.tldr ?? "") <= 90, hint: "Give a 15–90 word TL;DR that answers the question straight away." },
    { id: "faq", weight: 1, label: "Has an FAQ with at least 3 questions", pass: a.faq.length >= 3, hint: "Add at least 3 real questions and answers." },
    { id: "questions", weight: 1, label: "Questions are phrased the way people ask them", pass: questionHeads >= 3, hint: "Use question-style headings or FAQ questions." },
    { id: "lists", weight: 1, label: "Uses lists or steps AI can lift out", pass: /<(ul|ol|table)\b/i.test(html.replace(/<p><strong>In this article[\s\S]*?<\/ul>/i, "")), hint: "Add a bulleted or numbered list." },
    { id: "short", weight: 1, label: "Paragraphs are short and self-contained", pass: !longPara, hint: "Split any paragraph over 120 words." },
    { id: "facts", weight: 1, label: "Contains specific facts and figures", pass: numbers >= 3, hint: "Include more concrete numbers or measurements from your product facts." },
    { id: "productRef", weight: 1, label: "Points to the product page as the source", pass: productLinked, hint: "Link to the product page." },
    { id: "author", weight: 1, label: "Has a named author", pass: !!ctx.author.trim(), hint: "Set an author in the Organization section." },
  ];
  return {
    words: words(text),
    seo: { score: Math.round((gotW / totalW) * 100), checks: seo },
    ai: { passed: ai.filter((c) => c.pass).length, total: ai.length, checks: ai },
  };
}
