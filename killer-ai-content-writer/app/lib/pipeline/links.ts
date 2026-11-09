// Internal links added to a finished article. No AI involved: a link is only ever placed on words that are
// already in the text and match the collection or article's own name, so no new claims can slip in.
import { STOP, sameKeyword } from "../keywords";

export type LinkCollection = { title: string; handle: string };
export type LinkArticle = { title: string; keyword: string | null; path: string };
export type LinkTargets = {
  collections: LinkCollection[];
  articles: LinkArticle[];
  /** The article being written, so it never competes with or links to itself. */
  selfKeyword: string;
};
export type AddedLink = { kind: "collection" | "article"; phrase: string; path: string };

const MAX_COLLECTIONS = 2;
const MAX_ARTICLES = 1; // one related article is plenty; more links dilute the page and distract the reader
const GENERIC_COLLECTION = new Set(["all", "frontpage", "home", "home page", "homepage", "featured", "new", "sale", "best sellers", "bestsellers"]);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A regex for a phrase that tolerates plurals, hyphens and case ("reusable bag" finds "Reusable-bags"). */
function phraseRegex(words: string[]): RegExp {
  const parts = words.map((w) => (/s$/.test(w) ? esc(w.replace(/e?s$/, "")) + "(?:e?s)?" : esc(w) + "(?:e?s)?"));
  return new RegExp(`(?<![A-Za-z0-9])(${parts.join("[\\s-]+")})(?![A-Za-z0-9])`, "i");
}

type Line = { text: string; ok: boolean };

/** Splits the body into lines and marks which ones may carry a link: plain paragraphs and list items, past the intro, with no link yet. */
function prepare(md: string): Line[] {
  let seenParagraph = false;
  return md.split("\n").map((text) => {
    const t = text.trim();
    if (!t || /^#{1,6}\s/.test(t) || /^!\[/.test(t) || /^>/.test(t)) return { text, ok: false };
    const isList = /^([-*+]|\d+\.)\s/.test(t);
    const first = !seenParagraph && !isList;
    if (!isList) seenParagraph = true;
    const hasLink = /\]\([^)]*\)|\{\{/.test(text);
    return { text, ok: !first && !hasLink };
  });
}

/** Finds the first place in the ok lines where the phrase appears as plain text (not in bold/italic markers). */
function place(lines: Line[], words: string[]): { line: number; start: number; end: number; text: string } | null {
  const re = phraseRegex(words);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].ok) continue;
    const m = re.exec(lines[i].text);
    if (!m) continue;
    const before = lines[i].text.slice(0, m.index);
    const after = lines[i].text.slice(m.index + m[1].length);
    if (/[*_`]$/.test(before) || /^[*_`]/.test(after)) continue; // inside emphasis: skip rather than break the markup
    return { line: i, start: m.index, end: m.index + m[1].length, text: m[1] };
  }
  return null;
}

const plainWords = (s: string) => s.toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(Boolean);

function collectionWords(title: string): string[] {
  const w = plainWords(title).filter((x) => !["collection", "collections", "range", "shop"].includes(x));
  return w;
}

/** Contiguous runs of a phrase's words that carry meaning, longest first (3+ words), for matching an article's topic. */
function runs(words: string[], min: number): string[][] {
  const out: string[][] = [];
  for (let len = words.length; len >= min; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const run = words.slice(i, i + len);
      if (STOP.has(run[0]) || STOP.has(run[run.length - 1])) continue;
      out.push(run);
    }
  }
  return out;
}

export function addInternalLinks(
  md: string,
  targets: LinkTargets,
  want: { collections: boolean; articles: boolean },
): { md: string; added: AddedLink[] } {
  const lines = prepare(md);
  const added: AddedLink[] = [];
  const link = (kind: AddedLink["kind"], found: NonNullable<ReturnType<typeof place>>, path: string) => {
    const l = lines[found.line];
    l.text = `${l.text.slice(0, found.start)}[${found.text}](${path})${l.text.slice(found.end)}`;
    l.ok = false; // at most one added link per paragraph
    added.push({ kind, phrase: found.text, path });
  };

  if (want.articles) {
    let best: { found: NonNullable<ReturnType<typeof place>>; score: number; path: string } | null = null;
    for (const a of targets.articles) {
      if (a.keyword && targets.selfKeyword && sameKeyword(a.keyword, targets.selfKeyword)) continue;
      // Whole search phrase or whole title first (2+ words), then long runs of them (3+ words).
      const phrases: string[][] = [];
      for (const src of [a.keyword ?? "", ...a.title.split(/[:–—|]/)]) {
        const w = plainWords(src);
        if (w.filter((x) => !STOP.has(x)).length >= 2) phrases.push(w);
      }
      const longer = [a.keyword ?? "", a.title].flatMap((src) => runs(plainWords(src), 3));
      for (const words of [...phrases, ...longer]) {
        const found = place(lines, words);
        if (!found) continue;
        const score = words.filter((x) => !STOP.has(x)).length;
        if (score >= 2 && (!best || score > best.score)) best = { found, score, path: a.path };
        break; // the first (longest) phrase that fits is this article's best match
      }
    }
    if (best && added.filter((x) => x.kind === "article").length < MAX_ARTICLES) link("article", best.found, best.path);
  }

  if (want.collections) {
    const text = md.toLowerCase();
    const ranked = targets.collections
      .map((c) => ({ c, words: collectionWords(c.title) }))
      .filter(({ c, words }) => words.length && !GENERIC_COLLECTION.has(plainWords(c.title).join(" ")) && !GENERIC_COLLECTION.has(c.handle))
      .sort((x, y) => y.words.length - x.words.length);
    for (const { c, words } of ranked) {
      if (added.filter((x) => x.kind === "collection").length >= MAX_COLLECTIONS) break;
      // A one-word collection (like "Bamboo") is too loose unless the word is a real topic of the article.
      if (words.length === 1) {
        const hits = text.split(new RegExp(`\\b${esc(words[0])}`)).length - 1;
        if (words[0].length < 5 || hits < 3) continue;
      }
      const found = place(lines, words);
      if (found) link("collection", found, `/collections/${c.handle}`);
    }
  }

  return { md: lines.map((l) => l.text).join("\n"), added };
}
