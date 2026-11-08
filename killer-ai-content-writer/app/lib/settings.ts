// Settings shared by server and client. No server-only imports here.
import { TLDR_DEFAULTS, type TldrStyle } from "./tldr";

export type AppSettings = TldrStyle & {
  // Brand voice
  brandDescription: string;
  wordsToUse: string;
  wordsToAvoid: string;
  neverMention: string;
  // Store details
  businessName: string;
  whatYouSell: string;
  audience: string;
  // Publishing
  blogId: string; // "" = store's first blog
  defaultAuthor: string;
  publishMode: "draft" | "live";
  keywordsAsTags: boolean;
  linkToOtherArticles: boolean;
  articleTemplate: string;
  // Writing
  language: "en-AU";
  maxWords: number | null; // null = let the facts decide
  // Advanced
  toc: boolean;
  articleSchema: boolean;
  faqSchema: boolean;
  breadcrumbSchema: boolean;
  customIdeasPrompt: string;
  customContentPrompt: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  brandDescription: "",
  wordsToUse: "",
  wordsToAvoid: "",
  neverMention: "",
  businessName: "",
  whatYouSell: "",
  audience: "",
  blogId: "",
  defaultAuthor: "",
  publishMode: "draft",
  keywordsAsTags: true,
  linkToOtherArticles: false,
  articleTemplate: "",
  language: "en-AU",
  maxWords: null,
  toc: false,
  articleSchema: false,
  faqSchema: false,
  breadcrumbSchema: false,
  customIdeasPrompt: "",
  customContentPrompt: "",
  ...TLDR_DEFAULTS,
};

export const LANGUAGE_NAMES: Record<AppSettings["language"], string> = {
  "en-AU": "Australian English (Australian spelling, vocabulary and metric units)",
};

const BASELINE_VOICE = `- Second person, calm and plain-spoken. Short paragraphs.
- Opens with the reader's real questions, then gives a direct answer early.
- Balanced and honest: says when a product is not for everyone, names trade-offs, mentions alternatives fairly. Never pushy.
- Careful with claims: "can", "may", "according to the instructions". Open about what it cannot promise, without commenting on its own writing process.
- Health topics: follow the supplied instructions, see a qualified health professional, end with a general-information-only note.
- Structure: TL;DR first, question-style H2s, short lists for trade-offs, a gentle product section near the end.
- Ends with a reassuring, low-pressure note. No hype words, no emoji in body copy.
- These are traits, not a script: never reuse distinctive wording from any example.`;

/** The voice guide the writer receives. The merchant's own description takes priority over the baseline. */
export function voiceGuide(s: AppSettings): string {
  const parts: string[] = [];
  if (s.brandDescription.trim()) parts.push(`THE STORE'S OWN VOICE (follow this first)\n${s.brandDescription.trim()}`);
  if (s.wordsToUse.trim()) parts.push(`Words and phrases this store likes to use: ${s.wordsToUse.trim()}`);
  if (s.wordsToAvoid.trim()) parts.push(`Words and phrases to avoid: ${s.wordsToAvoid.trim()}`);
  parts.push(`BASELINE VOICE (use only where the store's own voice is silent)\n${BASELINE_VOICE}`);
  return parts.join("\n\n");
}

/** Extra context lines for the model, built from settings. Fact rules are never overridable. */
export function settingsContext(s: AppSettings, kind: "ideas" | "content"): string {
  const lines: string[] = [`LANGUAGE\n${LANGUAGE_NAMES[s.language]}`];
  const store = [
    s.businessName && `Business name: ${s.businessName}`,
    s.whatYouSell && `What the store sells: ${s.whatYouSell}`,
    s.audience && `Who it is for: ${s.audience}`,
  ].filter(Boolean);
  if (store.length) lines.push(`STORE DETAILS (context only, never a source of product facts)\n${store.join("\n")}`);
  if (kind === "content") {
    if (s.neverMention.trim()) lines.push(`NEVER MENTION (competitors, claims or topics to leave out)\n${s.neverMention.trim()}`);
    if (s.maxWords) lines.push(`LENGTH LIMIT\nDo not exceed ${s.maxWords} words in total. A shorter article is fine if the facts are thin.`);
  }
  const custom = kind === "ideas" ? s.customIdeasPrompt : s.customContentPrompt;
  if (custom.trim())
    lines.push(
      `EXTRA INSTRUCTIONS FROM THE STORE (style, structure and focus only. They take priority over the default style and quality rules, but can NEVER override the fact rules: product data and merchant facts remain the only source of truth)\n${custom.trim()}`,
    );
  return lines.join("\n\n");
}
