// Deterministic checks. The AI does not get to grade these.
import { readFile } from "node:fs/promises";
const LEAKS = /product (data|information)|according to the (data|information)|store currency|example\.com|\bUNVERIFIED\b|\[(INTERNAL|EXTERNAL)|not going to invent|deliberately not|dollar figure|reputable (health )?organi[sz]ation|for background only|merchant facts/i;
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
function shingles(words, n = 7) { const s = new Set(); for (let i = 0; i + n <= words.length; i++) s.add(words.slice(i, i + n).join(" ")); return s; }
export async function loadReference(files = []) {
  const all = new Set();
  for (const f of files) for (const s of shingles(norm(await readFile(new URL("./" + f, import.meta.url), "utf8")))) all.add(s);
  return all;
}
export function articleText(a) { return [a.h1, a.tldr, a.body_markdown, ...a.faq.map((f) => f.q + " " + f.a)].join("\n"); }
export function runChecks(a, ref) {
  const all = articleText(a);
  const words = all.split(/\s+/).filter(Boolean).length;
  const productLinks = (a.body_markdown.match(/\{\{PRODUCT_URL\}\}/g) || []).length;
  const otherLinks = (a.body_markdown.match(/\]\((?!\{\{PRODUCT_URL\}\})[^)]+\)/g) || []).length;
  const h2 = (a.body_markdown.match(/^## /gm) || []).length;
  const copied = ref ? [...shingles(norm(all))].filter((s) => ref.has(s)) : [];
  const similarity = { sharedSevenWordRuns: copied.length, example: copied[0] || null };
  const issues = [];
  if (a.title_tag.length > 60) issues.push(`title_tag is ${a.title_tag.length} chars (max 60)`);
  if (a.meta_description.length > 155) issues.push(`meta_description is ${a.meta_description.length} chars (max 155)`);
  if (productLinks !== 1) issues.push(`expected exactly 1 product link token, found ${productLinks}`);
  if (otherLinks) issues.push(`${otherLinks} unexpected link(s)`);
  if (/^## Sources/im.test(a.body_markdown)) issues.push("has a Sources section but no sources were provided");
  if (h2 < 3) issues.push(`only ${h2} H2 headings`);
  if (a.faq.length < 3) issues.push(`only ${a.faq.length} FAQ items`);
  if (LEAKS.test(all)) issues.push(`leaked wording: "${all.match(LEAKS)[0]}"`);
  if (/\$\s?\d/.test(all)) issues.push("mentions a price");
  return { words, h2, productLinks, issues, similarity };
}
