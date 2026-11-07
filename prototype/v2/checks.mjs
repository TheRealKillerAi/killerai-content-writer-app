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

// Evidence verification: the model must quote its evidence; code confirms the quote really exists.
const flat = (t) => t.replace(/<[^>]+>/g, " ").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set('with this that your from have they them then than will were been into also each when what which their there about after before while more most some such only over under the and for are you can may not but all any its our out use used using'.split(' '));
export function verifyClaims(raw, factsText) {
  const hay = " " + flat(factsText) + " ";
  const unsupported = [];
  for (const c of raw.claims || []) {
    const q = c.evidence ? flat(String(c.evidence)) : "";
    const content = (t) => t.split(" ").filter((w) => w.length >= 4 && !STOP.has(w));
    const ev = content(q).map((w) => w.slice(0, 4));
    const sw = content(flat(String(c.sentence || "")));
    const overlap = sw.length ? sw.filter((w) => ev.includes(w.slice(0, 4))).length / sw.length : 1;
    const ok = q.split(" ").length >= 3 && hay.includes(" " + q + " ") && overlap >= 0.4;
    if (!ok) unsupported.push({ text: c.sentence, problem: !c.evidence ? "no supporting evidence" : hay.includes(" " + q + " ") ? "the quoted evidence does not support this sentence" : "quoted evidence not found in product data or merchant facts", category: c.category });
  }
  return { claims: raw.claims || [], unsupported, risky: [], leaks: raw.leaks || [] };
}
export function findRepeats(body) {
  const sentences = body.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 6);
  const seen = new Map(); const out = [];
  sentences.forEach((s, i) => {
    const w = norm(s);
    for (const sh of shingles(w, 6)) {
      if (seen.has(sh) && seen.get(sh) !== i) { out.push({ text: s, problem: `repeats an earlier sentence ("${sh}")` }); return; }
      if (!seen.has(sh)) seen.set(sh, i);
    }
  });
  return out;
}
