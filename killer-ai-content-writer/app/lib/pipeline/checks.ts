// Deterministic checks. The AI does not get to grade these.
import type { Article, AuditReport } from "./types";

const LEAKS =
  /product (data|information)|according to the (data|information)|store currency|example\.com|\bUNVERIFIED\b|\[(INTERNAL|EXTERNAL)|not going to invent|deliberately not|dollar figure|reputable (health )?organi[sz]ation|for background only|merchant facts/i;
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
function shingles(words: string[], n = 7) {
  const s = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) s.add(words.slice(i, i + n).join(" "));
  return s;
}

export function articleText(a: Article) {
  return [a.h1, a.tldr, a.body_markdown, ...a.faq.map((f) => f.q + " " + f.a)].join("\n");
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

export function runChecks(a: Article) {
  const all = articleText(a);
  const words = all.split(/\s+/).filter(Boolean).length;
  const productLinks = (a.body_markdown.match(/\{\{PRODUCT_URL\}\}/g) || []).length;
  const otherLinks = (a.body_markdown.match(/\]\((?!\{\{PRODUCT_URL\}\})[^)]+\)/g) || []).length;
  const h2 = (a.body_markdown.match(/^## /gm) || []).length;
  const issues: string[] = [];
  if (a.title_tag.length > 60) issues.push(`Title tag is ${a.title_tag.length} characters (max 60)`);
  if (a.meta_description.length > 155) issues.push(`Meta description is ${a.meta_description.length} characters (max 155)`);
  if (productLinks !== 1) issues.push(`Expected exactly 1 product link, found ${productLinks}`);
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
  if (a.faq.length < 3) issues.push(`Only ${a.faq.length} FAQ items`);
  if (LEAKS.test(all)) issues.push(`Leaked wording: "${all.match(LEAKS)![0]}"`);
  if (/\$\s?\d/.test(all)) issues.push("Mentions a price");
  return { words, h2, productLinks, issues };
}

// Evidence verification: the model must quote its evidence; code confirms the quote really exists.
const flat = (t: string) =>
  t.replace(/<[^>]+>/g, " ").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
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
    if (!text || text.includes("{{PRODUCT_URL}}") || /\?\**$/.test(text) || text.split(/\s+/).length < 4) return;
    out.push({ id: "S" + ++n, text, where });
  };
  sents(a.tldr).forEach((t) => add(t, "tldr"));
  for (const line of a.body_markdown.split("\n")) {
    if (/^#{1,6}\s/.test(line)) continue;
    sents(line.replace(/^\s*(?:[-*+]\s+|\d+\.\s+|>\s*)/, "")).forEach((t) => add(t, "body"));
  }
  a.faq.forEach((f) => sents(f.a).forEach((t) => add(t, "faq")));
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
    const found =
      quotes.length > 0 &&
      quotes.every((x) => (x.split(" ").length >= 3 || (fromAnswer && x.length >= 2)) && hay.includes(" " + x + " "));
    if (!found || overlap < 0.4)
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

export function findRepeats(body: string) {
  const sentences = body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 4);
  const seen = new Map<string, number>();
  const out: { text: string; problem: string }[] = [];
  sentences.forEach((s, i) => {
    const w = norm(s);
    for (const sh of shingles(w, Math.min(6, w.length))) {
      if (seen.has(sh) && seen.get(sh) !== i) {
        out.push({ text: s, problem: `repeats an earlier sentence ("${sh}")` });
        return;
      }
      if (!seen.has(sh)) seen.set(sh, i);
    }
  });
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
    const dup = sh.some((x) => seen.has(x));
    if (!dup) sh.forEach((x) => seen.add(x));
    return dup;
  };
  const out: string[] = [];
  for (const line of md.split("\n")) {
    if (/^#{1,6}\s/.test(line) || !line.trim() || line.includes("{{PRODUCT_URL}}")) {
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
