// Deterministic checks. The AI does not get to grade these.
import type { Article, AuditReport } from "./types";

const LEAKS =
  /product (data|information|details|description|listing)|as (described|listed|stated|specified|noted|shown) (in|on|by) (the|our) |according to the (data|information)|store currency|example\.com|\bUNVERIFIED\b|\[(INTERNAL|EXTERNAL)|not going to invent|deliberately not|dollar figure|reputable (health )?organi[sz]ation|for background only|merchant facts/i;
// Text that only another app's editor or a template would leave behind: editor links, "Author" placeholders, image notes.
const PLACEHOLDERS: [RegExp, string][] = [
  [/tryautoseo|article-editor|\bapp\.[a-z0-9-]+\.(?:com|io|ai)\/[^\s)]*editor/i, "a link into another app's editor"],
  [/^#{1,6}\s*(?:the\s+)?author\s*$/im, 'an "Author" heading'],
  [/written by an author\b|\[(?:your|author|brand|store|company)(?: name)?\]|\binsert (?:image|photo|link)\b|lorem ipsum/i, "placeholder wording"],
  [/^\s*[*_]{1,2}(?:icons?|image|photo|illustration|infographic|diagram|graphic|checklist|lifecycle|steps? on|board of)\b[^\n]*[*_]{1,2}\s*$/im, "an image note written as text"],
  [/\{\{(?!PRODUCT_URL|ARTICLE_URL)[^}]*\}\}/, "an unfilled {{placeholder}}"],
];
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
function shingles(words: string[], n = 7) {
  const s = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) s.add(words.slice(i, i + n).join(" "));
  return s;
}

export function articleText(a: Article) {
  return [a.h1, a.tldr, a.excerpt ?? "", a.body_markdown, ...a.faq.map((f) => f.q + " " + f.a), a.email_body ?? "", a.social_post ?? ""].join("\n");
}

export function sections(md: string) {
  const out: { title: string; words: number }[] = [];
  let cur: { title: string; words: number } | null = null;
  for (const line of md.split("\n")) {
    if (/^#{2,6}\s/.test(line)) {
      cur = { title: line.replace(/^#+\s*/, ""), words: 0 };
      out.push(cur);
    } else if (cur) cur.words += line.split(/\s+/).filter(Boolean).length;
  }
  return out;
}

/** The last H2 section of the body: where the closing call to action lives. */
export function closingSection(md: string): { start: number; heading: string; body: string } | null {
  const idx = [...md.matchAll(/^## .*$/gm)];
  const last = idx[idx.length - 1];
  if (!last || last.index === undefined) return null;
  const heading = last[0].replace(/^##\s*/, "").trim();
  return { start: last.index, heading, body: md.slice(last.index + last[0].length).trim() };
}

const WEAK_HEADING = /^(a\s+)?(final\s+(note|thoughts?|word)|conclusion|summary|wrapping up|wrap[- ]up|in summary|making your choice|the bottom line|to sum up|closing thoughts?)\b/i;
const WEAK_CLOSER = /\b(see if (it|they|this) (fits?|suits?|works?)|fits? your (needs|routine|lifestyle|requirements)|view the [^.]{0,60} on our (store|site|website)|on our (store|site|website) to|check (it|them) out|take a look|learn more|explore (our|the) (range|collection|products)|visit our (store|shop|website)|browse our)\b/i;

/** True when the closing section is vague: a stock heading, a vague closer, or too thin to say anything. */
export function genericClosing(md: string): boolean {
  const c = closingSection(md);
  if (!c) return false;
  const words = c.body.split(/\s+/).filter(Boolean).length;
  return WEAK_HEADING.test(c.heading) || WEAK_CLOSER.test(c.body) || words < 25;
}

export function runChecks(a: Article) {
  const all = articleText(a);
  const words = [a.tldr, a.body_markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, ""), ...a.faq.map((f) => f.q + " " + f.a)].join("\n").split(/\s+/).filter(Boolean).length;
  const productLinks = (a.body_markdown.match(/\{\{PRODUCT_URL(?::[a-z0-9_-]+)?\}\}/g) || []).length;
  // Links to the store's own collections and articles are added by the app (see links.ts) and are allowed.
  const otherLinks = (a.body_markdown.match(/\]\((?!\{\{PRODUCT_URL|\/(?:collections|blogs)\/[a-z0-9_\/-]+\))[^)]+\)/g) || []).length;
  const h2 = (a.body_markdown.match(/^## /gm) || []).length;
  const issues: string[] = [];
  if (a.title_tag.length > 60) issues.push(`Title tag is ${a.title_tag.length} characters (max 60)`);
  if (a.meta_description.length > 155) issues.push(`Meta description is ${a.meta_description.length} characters (max 155)`);
  if (a.guide ? productLinks < 2 : productLinks !== 1)
    issues.push(a.guide ? `A buying guide needs a link for each product, found ${productLinks}` : `Expected exactly 1 product link, found ${productLinks}`);
  if (otherLinks) issues.push(`${otherLinks} unexpected link(s)`);
  if (/^## Sources/im.test(a.body_markdown)) issues.push("Has a Sources section but no sources were provided");
  if (h2 < 3) issues.push(`Only ${h2} H2 headings`);
  const tl = a.tldr.split(/\s+/).filter(Boolean).length;
  if (tl < 25) issues.push(`TL;DR is only ${tl} words`);
  const secs = sections(a.body_markdown);
  if (secs.some((x) => x.words === 0)) issues.push("An empty section heading");
  secs
    .filter((x) => x.words > 0 && x.words < 8)
    .forEach((x) => issues.push(`Thin section "${x.title}" (${x.words} words): check it still answers its heading`));
  if (/^\s*[-*]\s*(\*\*\s*\*\*)?\s*$/m.test(a.body_markdown)) issues.push("An empty bullet");
  if (a.faq.length < 2) issues.push(`Only ${a.faq.length} FAQ item${a.faq.length === 1 ? "" : "s"}`);
  if (LEAKS.test(all)) issues.push(`Leaked wording: "${all.match(LEAKS)![0]}"`);
  const stray = PLACEHOLDERS.find(([re]) => re.test(all));
  if (stray) issues.push(`Contains ${stray[1]}`);
  if (genericClosing(a.body_markdown)) issues.push("The closing call to action is vague: make it specific");
  if (/\$\s?\d/.test(all)) issues.push("Mentions a price");
  return { words, h2, productLinks, issues };
}

// Evidence verification: the model must quote its evidence; code confirms the quote really exists.
const flat = (t: string) =>
  t
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
    .replace(/(\d)\s*[x×]\s*(?=\d)/g, "$1 ") // 20 x 28, 20x28 and 20 × 28 are the same size
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/(\d)([a-z])/g, "$1 $2") // 28cm and 28 cm are the same
    .replace(/\s+/g, " ")
    .trim();
const NUMWORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const STOP = new Set(
  "with this that your from have they them then than will were been into also each when what which their there about after before while more most some such only over under the and for are you can may not but all any its our out use used using".split(
    " ",
  ),
);

export type Sentence = { id: string; text: string; where: string };

export function splitSentences(a: Article): Sentence[] {
  const out: Sentence[] = [];
  let n = 0;
  const sents = (line: string) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9*_"(])/);
  const add = (text: string, where: string) => {
    text = text.trim();
    if (!text || text.includes("{{PRODUCT_URL") || text.includes("{{ARTICLE_URL}}") || /\?\**$/.test(text) || text.split(/\s+/).length < 4) return;
    out.push({ id: "S" + ++n, text, where });
  };
  sents(a.tldr).forEach((t) => add(t, "tldr"));
  if (a.excerpt) sents(a.excerpt).forEach((t) => add(t, "excerpt"));
  for (const line of a.body_markdown.split("\n")) {
    if (/^#{1,6}\s/.test(line) || /^!\[[^\]]*\]\(/.test(line.trim())) continue;
    sents(line.replace(/^\s*(?:[-*+]\s+|\d+\.\s+|>\s*)/, "")).forEach((t) => add(t, "body"));
  }
  a.faq.forEach((f) => sents(f.a).forEach((t) => add(t, "faq")));
  if (a.email_body) a.email_body.split("\n").forEach((l) => sents(l).forEach((t) => add(t, "email")));
  if (a.social_post) sents(a.social_post).forEach((t) => add(t, "social"));
  return out;
}

const NEEDS = new Set(["product_fact", "usage_step", "health_advice"]);
type RawAudit = {
  labels?: { id: string; category: string; evidence?: string | string[] | null }[];
  leaks?: { text?: string; problem?: string }[];
};

export function verifyLabels(
  sentences: Sentence[],
  raw: RawAudit,
  factsText: string,
  answers: Record<string, string> = {},
): AuditReport {
  const hay = " " + flat(factsText) + " ";
  const byId = new Map((raw.labels || []).map((l) => [l.id, l]));
  const unsupported: AuditReport["unsupported"] = [];
  const missing: string[] = [];
  for (const s of sentences) {
    const c = byId.get(s.id);
    if (!c) {
      missing.push(s.id);
      continue;
    }
    if (!NEEDS.has(c.category)) continue;
    const quotes = ([] as unknown[])
      .concat(c.evidence || [])
      .map((e) => flat(String(e)))
      .filter(Boolean);
    const q = quotes.join(" ");
    const content = (t: string) => t.split(" ").filter((w) => w.length >= 4 && !STOP.has(w));
    const fromAnswer = Object.entries(answers).find(([, a]) => quotes.length === 1 && flat(String(a)).includes(quotes[0]));
    const ev = content(q + (fromAnswer ? " " + flat(fromAnswer[0]) : "")).map((w) => w.slice(0, 4));
    const sw = content(flat(s.text));
    const overlap = sw.length ? sw.filter((w) => ev.includes(w.slice(0, 4))).length / sw.length : 1;
    // Sentences with numbers are judged on the numbers: every figure must be in the evidence, and a count
    // ("three sizes") must match the number of items quoted. Then the surrounding wording matters less.
    const rawEv = ([] as unknown[]).concat(c.evidence || []).map(String);
    const hayQ = " " + q + " ";
    const sentFlat = flat(s.text);
    const sentNums = (s.text.replace(/(\d)\s*[x×]\s*(?=\d)/g, "$1 ").match(/\d+(?:\.\d+)?(?:\s*[a-zA-Z]{1,3}\b)?/g) || []).map((n) => flat(n));
    const words = sentFlat.split(" ").filter((w) => w in NUMWORDS);
    const items = rawEv.length > 1 ? rawEv.length : (rawEv[0] || "").split(/[,;|\n]|\band\b|\/(?=\s)/i).filter((x) => x.trim()).length;
    const numsOk =
      sentNums.every((n) => hayQ.includes(" " + n + " ") || hayQ.includes(" " + n.replace(/ [a-z]+$/, "") + " ")) &&
      words.every((w) => hayQ.includes(" " + NUMWORDS[w] + " ") || hayQ.includes(" " + w + " ") || items >= NUMWORDS[w]);
    // A figure counts as backed when its number and unit appear together in the evidence (e.g. "0.02 kg").
    const strongNums = sentNums.filter((n) => n.includes(" ")).every((n) => hayQ.includes(" " + n + " "));
    const hasNums = sentNums.length + words.length > 0;
    const numsStrong = hasNums && numsOk && (words.length ? items >= Math.max(...words.map((w) => NUMWORDS[w])) : true) && strongNums;
    const found =
      quotes.length > 0 &&
      quotes.every((x) => (x.split(" ").length >= 3 || (fromAnswer && x.length >= 2)) && hay.includes(" " + x + " "));
    if (!found || (hasNums && !numsOk) || (!numsStrong && overlap < (hasNums ? 0.15 : 0.4)))
      unsupported.push({
        text: s.text,
        problem: !quotes.length
          ? `no supporting evidence (${c.category})`
          : found
            ? `the quoted evidence does not support this sentence (${c.category})`
            : "quoted evidence not found in product data or merchant facts",
        category: c.category,
      });
  }
  const leaks = (raw.leaks || [])
    .filter(
      (l) =>
        !hay.includes(" " + flat(String(l.text || "")) + " ") &&
        !hay.includes(" " + flat(String(l.text || "")).replace(/^(it|that)s? /, "") + " "),
    )
    .map((l) => ({ text: String(l.text || ""), problem: String(l.problem || "") }));
  return { unsupported, risky: [], leaks, missing };
}

export function dedupeSentences(md: string) {
  return md
    .split("\n")
    .map((line) => {
      const parts = line.split(/(?<=[.!?])\s+/);
      const out: string[] = [];
      for (const p of parts) if (!out.length || norm(p).join(" ") !== norm(out[out.length - 1]).join(" ")) out.push(p);
      return out.join(" ");
    })
    .join("\n");
}

export function renumber(md: string) {
  let n = 0;
  return md
    .split("\n")
    .map((l) => {
      const m = l.match(/^(\s*)\d+\.\s(.*)$/);
      if (m) {
        n++;
        return `${m[1]}${n}. ${m[2]}`;
      }
      if (l.trim()) n = 0;
      return l;
    })
    .join("\n");
}

export function cleanStructure(md: string) {
  md = dedupeSentences(md);
  let lines = md.split("\n").filter((l) => !/^\s*(?:[-*+]|\d+\.)\s*(?:\*\*\s*\*\*|\*\*|)\s*$/.test(l));
  for (let pass = 0; pass < 4; pass++) {
    const keep: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i])) {
        let k = i + 1;
        while (k < lines.length && !lines[k].trim()) k++;
        if (k >= lines.length || /^#{1,6}\s/.test(lines[k])) continue;
      }
      keep.push(lines[i]);
    }
    lines = keep;
  }
  return renumber(lines.join("\n").replace(/\n{3,}/g, "\n\n").trim());
}

const COPY_RATIO = 0.7; // a sentence is a repeat only if most of it already appeared word for word

export function findRepeats(body: string) {
  const sentences = body
    .split("\n")
    .filter((l) => !/^#{1,6}\s/.test(l))
    .flatMap((l) => l.replace(/^\s*(?:[-*+]\s+|\d+\.\s+|>\s*)/, "").split(/(?<=[.!?*])\s+(?=[A-Z0-9*_"(])/))
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 4);
  const seen = new Set<string>();
  const out: { text: string; problem: string }[] = [];
  for (const s of sentences) {
    const sh = [...shingles(norm(s), Math.min(6, norm(s).length))];
    if (!sh.length) continue;
    const hit = sh.filter((x) => seen.has(x));
    if (hit.length / sh.length >= COPY_RATIO) out.push({ text: s, problem: `copies an earlier sentence almost word for word ("${hit[0]}")` });
    sh.forEach((x) => seen.add(x));
  }
  return out;
}

export function repairLink(md: string, name: string) {
  return md.replace(/(?<!\()\{\{PRODUCT_URL\}\}(?!\))/g, `[${name}]({{PRODUCT_URL}})`);
}

/** Deterministically deletes any sentence that repeats an earlier one; drops bullets left with almost nothing. */
export function removeRepeats(md: string) {
  const seen = new Set<string>();
  const isDup = (sentence: string) => {
    const w = norm(sentence);
    if (w.length < 4) return false;
    const sh = [...shingles(w, Math.min(6, w.length))];
    const dup = sh.filter((x) => seen.has(x)).length / sh.length >= COPY_RATIO;
    if (!dup) sh.forEach((x) => seen.add(x));
    return dup;
  };
  const out: string[] = [];
  for (const line of md.split("\n")) {
    if (/^#{1,6}\s/.test(line) || !line.trim() || line.includes("{{PRODUCT_URL")) {
      out.push(line);
      continue;
    }
    const prefix = (line.match(/^\s*(?:[-*+]\s+|\d+\.\s+|>\s*)?/) || [""])[0];
    const parts = line.slice(prefix.length).split(/(?<=[.!?*])\s+(?=[A-Z0-9*_"(])/);
    const kept = parts.filter((p) => !isDup(p));
    if (kept.length === parts.length) {
      out.push(line);
      continue;
    }
    const text = kept.join(" ").trim();
    const words = text.replace(/[*_]/g, " ").split(/\s+/).filter(Boolean).length;
    if (words >= 6) out.push(prefix + text);
  }
  return out.join("\n");
}

/** The body split at its H2 headings: text before the first heading, then each section with its heading line. */
export function splitSections(md: string): { heading: string | null; text: string }[] {
  const out: { heading: string | null; text: string }[] = [];
  let cur: { heading: string | null; lines: string[] } = { heading: null, lines: [] };
  const flush = () => out.push({ heading: cur.heading, text: cur.lines.join("\n") });
  for (const line of md.split("\n")) {
    if (/^## /.test(line)) {
      flush();
      cur = { heading: line.replace(/^##\s*/, "").trim(), lines: [line] };
    } else cur.lines.push(line);
  }
  flush();
  return out.filter((s) => s.heading !== null || s.text.trim());
}

/** Removes the named H2 sections. Never the first section, the closing section, or one that holds a product link. */
export function removeSections(md: string, headings: string[]): { md: string; removed: string[] } {
  const wanted = new Set(headings.map((h) => norm(h).join(" ")));
  const parts = splitSections(md);
  const lastH = parts.map((p) => p.heading).lastIndexOf(parts.filter((p) => p.heading).pop()?.heading ?? null);
  const removed: string[] = [];
  const kept = parts.filter((p, i) => {
    if (!p.heading || i === lastH || i === parts.findIndex((x) => x.heading)) return true;
    if (p.text.includes("{{PRODUCT_URL")) return true;
    if (wanted.has(norm(p.heading).join(" "))) {
      removed.push(p.heading);
      return false;
    }
    return true;
  });
  return { md: kept.map((p) => p.text).join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

/** Cuts the first match of `plain` out of `text`, ignoring `**` markers, and the space after it. Returns null if it isn't there. */
function cutPlain(text: string, plain: string): string | null {
  let stripped = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "*" && text[i + 1] === "*") {
      i++;
      continue;
    }
    stripped += text[i];
    map.push(i);
  }
  const at = stripped.indexOf(plain);
  if (at < 0) return null;
  const from = map[at];
  let to = map[at + plain.length - 1] + 1;
  while (text.slice(to, to + 2) === "**") to += 2;
  if (text[to] === " ") to++;
  return text.slice(0, from) + text.slice(to);
}

/** Removes a flagged sentence from the article body (and from the edited HTML, if there is one). Null when it can't be found, so nothing is guessed. */
export function removeSentence(a: Article, flagged: string): Article | null {
  const plain = flagged.replace(/\*\*/g, "").replace(/^[-*+\d.\s]+/, "").trim();
  if (plain.length < 12) return null;
  const md = cutPlain(a.body_markdown, plain);
  if (md === null) return null;
  const next: Article = { ...a, body_markdown: cleanStructure(md) };
  if (a.body_html !== undefined) {
    // Match the same words even when tags (bold, links) sit between them.
    const words = plain.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(words.join("(?:\\s|&nbsp;|<[^>]*>)+") + "(?:\\s|&nbsp;)?");
    next.body_html = re.test(a.body_html) ? a.body_html.replace(re, "").replace(/<(p|li)[^>]*>\s*<\/\1>\s*/gi, "") : undefined;
  }
  return next;
}
