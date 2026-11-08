// Shared keyword helpers (no server-only imports). Used for scoring and for spotting topics that would compete.
import type { Angle } from "./pipeline/types";

export const STOP = new Set(
  "a an the to of for and or in on at by from with how what why when where which who is are be can do does your you it its this that as vs best my we i someone anyone everyone people things".split(" "),
);
export const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|ly|s)$/, "") : w);
export const tokens = (k: string) => k.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));

/** Two stemmed words match when they are equal or share a start (love / loves / lover). */
export const wordsMatch = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));

/** How much of the keyword's important words appear in the text, from 0 to 1. */
export function keywordCoverage(text: string, keyword: string): number {
  const t = tokens(keyword).map(stem);
  if (!t.length) return 1;
  const have = [...new Set(tokens(text).map(stem))];
  return t.filter((w) => have.some((h) => wordsMatch(h, w))).length / t.length;
}

/** True when two search phrases are about the same thing, so two articles would compete for it. */
export function sameKeyword(a: string, b: string): boolean {
  const ta = tokens(a).map(stem);
  const tb = tokens(b).map(stem);
  if (!ta.length || !tb.length) return false;
  const hits = ta.filter((w) => tb.some((x) => wordsMatch(x, w))).length;
  return hits / Math.max(ta.length, tb.length) >= 0.75;
}

export type Covered = {
  id: string;
  productId: string;
  keyword: string | null;
  title: string | null;
  sentAs: "draft" | "live" | null;
};

/** The article (if any) that already targets this topic's search phrase. Prefers one that is already on the blog. */
export function findCovered(angle: Pick<Angle, "target_query" | "working_title">, covered: Covered[]): Covered | null {
  const hits = covered.filter(
    (c) =>
      (c.keyword && angle.target_query && sameKeyword(angle.target_query, c.keyword)) ||
      (c.title && angle.working_title && c.title.trim().toLowerCase() === angle.working_title.trim().toLowerCase()),
  );
  return hits.find((h) => h.sentAs) ?? hits[0] ?? null;
}
