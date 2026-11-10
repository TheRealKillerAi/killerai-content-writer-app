// Internal links added to a finished article. No AI involved: a link is only ever placed on words that are
// already in the text, so no new claims can slip in. Which collection or article to link is decided by how
// relevant it is to the article (shared topic words), not by an exact title match, because nobody's
// collection called "Reusable Household Products" appears word for word in an article.
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

/** Words that say little about a topic: shop-speak and title filler. A collection made only of these is never linked. */
const GENERIC = new Set(
  ("eco ecofriendly friendly sustainable sustainability product products item items home homes house essential essentials australia australian " +
    "zero waste new best selling seller sellers featured swap swaps solution solutions affiliate affiliates return returns free all range collection " +
    "shop store sale top guide ultimate complete reason reasons truth game changer tip tips week need know everything about why what switch benefit " +
    "benefits way ways make made better good great right actually really just more most real day days year years use using used get your our us " +
    "frontpage page may not but was has had will have been into than then them they their also very much many some such only even still ever " +
    "like long short high low full part first last next other another every each both either neither being does done").split(" "),
);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const words0 = (s: string) => s.split(/[^A-Za-z]+/).filter(Boolean);
const plainWords = (s: string) => s.toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(Boolean);

/** A crude word stem so reuse / reusable / reused, or bag / bags, count as the same topic word. */
export function topicStem(word: string): string {
  const w = word.toLowerCase().replace(/'/g, "");
  for (const suf of ["ables", "able", "ing", "ers", "er", "ed", "es", "s", "e"]) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}

/** The topic words of a title or phrase, as stems: no stop words, filler, numbers or years. */
function topicStems(text: string): string[] {
  const out: string[] = [];
  for (const w of plainWords(text)) {
    if (STOP.has(w) || GENERIC.has(w) || GENERIC.has(topicStem(w)) || /^\d/.test(w) || w.length < 4) continue;
    const s = topicStem(w);
    if (!out.includes(s)) out.push(s);
  }
  return out;
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

/** How often each topic stem is used in the article's own words (links, URLs and image lines don't count). */
function stemCounts(md: string): Map<string, number> {
  const clean = md
    .split("\n")
    .filter((l) => !/^!\[/.test(l.trim()))
    .join("\n")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/\{\{[^}]*\}\}/g, " ");
  const counts = new Map<string, number>();
  for (const w of plainWords(clean)) {
    const s = topicStem(w);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return counts;
}

type Found = { line: number; start: number; end: number; text: string };

/**
 * Finds a place to put a link for a set of topic stems (most important first): the first usable line that
 * uses one of them. The link goes on that word plus a neighbouring word that reads naturally with it
 * ("reusable bags"), never across bold or italic markers.
 */
function place(lines: Line[], stems: string[]): Found | null {
  for (const stemWord of stems) {
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].ok) continue;
      const text = lines[i].text;
      const re = /[A-Za-z][A-Za-z'-]*/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (topicStem(m[0]) !== stemWord) continue;
        let start = m.index;
        let end = m.index + m[0].length;
        const before = text.slice(0, start);
        const after = text.slice(end);
        if (/[*_`[]$/.test(before) || /^[*_`\]]/.test(after)) continue; // inside emphasis or a link: skip rather than break it
        const next = /^ ([A-Za-z][A-Za-z-]*)(?![A-Za-z-])/.exec(after);
        const prev = /(?<![A-Za-z-])([A-Za-z][A-Za-z-]*) $/.exec(before);
        const ok = (w: string) => !STOP.has(w.toLowerCase()) && w.length > 2;
        const other = stems.filter((s) => s !== stemWord);
        if (prev && ok(prev[1]) && (other.includes(topicStem(prev[1])) || !next || !ok(next[1]))) {
          start -= prev[1].length + 1;
        } else if (next && ok(next[1])) {
          end += next[1].length + 1;
        }
        // Never end the link on a trailing space or punctuation, and avoid a lone very short word.
        const phrase = text.slice(start, end);
        if (phrase.replace(/[^A-Za-z]/g, "").length < 4) continue;
        return { line: i, start, end, text: phrase };
      }
    }
  }
  return null;
}

type Scored = { stems: string[]; shared: string[]; score: number };

/** How relevant a collection or article is to this text, from the topic words they share. */
function relevance(candidate: string, counts: Map<string, number>, selfStems: Set<string>, avoid?: Set<string>): Scored | null {
  const stems = topicStems(candidate);
  if (!stems.length) return null;
  // Words that only name the product being written about (its material, its type) say nothing about a related article.
  const shared = stems.filter((s) => (counts.get(s) ?? 0) >= 1 && !avoid?.has(s));
  if (!shared.length) return null;
  const strongest = Math.max(...shared.map((s) => counts.get(s) ?? 0));
  const score = shared.reduce((n, s) => n + Math.min(counts.get(s) ?? 0, 3) + (selfStems.has(s) ? 2 : 0), 0);
  return { stems, shared: shared.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0)), score: score + (shared.length / stems.length) * 2 + (strongest >= 2 ? 0 : -10) };
}

export function addInternalLinks(
  md: string,
  targets: LinkTargets,
  want: { collections: boolean; articles: boolean },
  selfTitle = "",
  productTitle = "",
): { md: string; added: AddedLink[] } {
  const avoid = new Set(topicStems(productTitle));
  const lines = prepare(md);
  const added: AddedLink[] = [];
  const counts = stemCounts(md);
  const selfStems = new Set([...topicStems(targets.selfKeyword), ...topicStems(selfTitle)]);
  const link = (kind: AddedLink["kind"], found: Found, path: string) => {
    const l = lines[found.line];
    l.text = `${l.text.slice(0, found.start)}[${found.text}](${path})${l.text.slice(found.end)}`;
    l.ok = false; // at most one added link per paragraph
    added.push({ kind, phrase: found.text, path });
  };

  if (want.articles) {
    const ranked = targets.articles
      .filter((a) => !(a.keyword && targets.selfKeyword && sameKeyword(a.keyword, targets.selfKeyword)))
      .map((a) => ({ a, r: relevance(`${a.keyword ?? ""} ${a.title}`, counts, selfStems, avoid) }))
      // A related article must share at least two topic words with this one, one of them used more than once.
      .filter((x): x is { a: LinkArticle; r: Scored } => !!x.r && x.r.shared.length >= 2 && x.r.shared.length / x.r.stems.length >= 0.5 && x.r.score >= 4)
      .sort((x, y) => y.r.score - x.r.score);
    for (const { a, r } of ranked) {
      const found = place(lines, r.shared);
      if (found) {
        link("article", found, a.path);
        break;
      }
    }
  }

  if (want.collections) {
    const ranked = targets.collections
      .map((c) => ({ c, r: relevance(c.title, counts, selfStems) }))
      // A collection is relevant when its topic word (e.g. "reusable", "kitchen") is a real theme of the article.
      // ...and either two of its topic words appear, or its one word is also a topic of the article's own title or search phrase.
      .filter((x): x is { c: LinkCollection; r: Scored } => !!x.r && x.r.score >= 3 && x.r.shared.length / x.r.stems.length >= 0.5 && (x.r.shared.length >= 2 || x.r.shared.some((w) => selfStems.has(w))))
      .sort((x, y) => y.r.score - x.r.score);
    for (const { c, r } of ranked) {
      if (added.filter((x) => x.kind === "collection").length >= MAX_COLLECTIONS) break;
      const found = place(lines, r.shared);
      if (found) link("collection", found, `/collections/${c.handle}`);
    }
  }

  return { md: lines.map((l) => l.text).join("\n"), added };
}

/**
 * Puts a link on a phrase that is already in the article (exact words, any capitalisation), in the first usable
 * paragraph or list item. Returns null when the phrase is not there, so an invented anchor can never be used.
 */
export function addLinkOnPhrase(md: string, phrase: string, path: string, productTitle = ""): { md: string; phrase: string } | null {
  const avoid = new Set(topicStems(productTitle));
  // The link must not sit on the name of the product itself (that is the product link's job).
  if (words0(phrase).some((w) => avoid.has(topicStem(w)))) return null;
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 6 || phrase.replace(/[^A-Za-z]/g, "").length < 4) return null;
  const re = new RegExp(`(?<![A-Za-z0-9])(${words.map(esc).join("\\s+")})(?![A-Za-z0-9])`, "i");
  const lines = prepare(md);
  for (const l of lines) {
    if (!l.ok || /^\s*([-*+]|\d+\.)\s/.test(l.text)) continue; // paragraphs only, not list items
    const m = re.exec(l.text);
    if (!m) continue;
    const before = l.text.slice(0, m.index);
    const after = l.text.slice(m.index + m[1].length);
    if (/[*_`[]$/.test(before) || /^[*_`\]]/.test(after)) continue;
    l.text = `${before}[${m[1]}](${path})${after}`;
    return { md: lines.map((x) => x.text).join("\n"), phrase: m[1] };
  }
  return null;
}
