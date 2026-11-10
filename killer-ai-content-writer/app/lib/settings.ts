// Settings shared by server and client. No server-only imports here.
import { TLDR_DEFAULTS, type TldrStyle } from "./tldr";
import { DEFAULT_RULES, type RuleId, type RuleMode } from "./refreshRules";

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
  defaultAuthorId: string; // an author from the Authors page ("" = none chosen)
  authorBox: boolean; // add an "About the author" box at the end of articles
  // Filled in from the chosen author when settings are loaded; never saved from the form.
  authorBio: string;
  authorTitle: string;
  authorUrl: string;
  authorPhoto: string;
  authorVoice: string;
  publishMode: "draft" | "live";
  keywordsAsTags: boolean;
  linkToCollections: boolean; // link words in new articles to the store's own collections
  linkToOtherArticles: boolean; // link one related article, only where the text really matches
  articleTemplate: string;
  disclaimerEnabled: boolean;
  disclaimerText: string;
  // Writing
  language: "en-AU";
  maxWords: number | null; // null = let the facts decide
  // Schedule
  scheduleEnabled: boolean;
  scheduleDays: string; // comma-separated weekday numbers, 0 = Sunday
  scheduleTime: string; // "HH:MM" in the chosen time zone
  timeZone: string; // IANA name, "" = the store's own
  scheduleImage: "product" | "none";
  mixProduct: boolean; // schedule product articles
  mixGuides: boolean; // schedule buying guides
  planDays: 7 | 14 | 30; // how many days of topics to line up
  refillDays: number; // 0 = keep topped up every night; otherwise top up when this many days or fewer are left
  // Notifications
  notifyEmail: string; // "" = the store's email
  notifyFailure: "tell" | "skip";
  notifyUpcoming: "weekly" | "off";
  // Advanced
  toc: boolean;
  articleSchema: boolean;
  faqSchema: boolean;
  breadcrumbSchema: boolean;
  customIdeasPrompt: string;
  customContentPrompt: string;
  customEmailPrompt: string;
  // AI Refresh
  refreshRules: Record<RuleId, RuleMode>;
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
  defaultAuthorId: "",
  authorBox: false,
  authorBio: "",
  authorTitle: "",
  authorUrl: "",
  authorPhoto: "",
  authorVoice: "",
  publishMode: "draft",
  keywordsAsTags: true,
  linkToCollections: false,
  linkToOtherArticles: false,
  articleTemplate: "",
  disclaimerEnabled: false,
  disclaimerText: "This article is general information only and is not professional advice.",
  language: "en-AU",
  maxWords: null,
  scheduleEnabled: false,
  scheduleDays: "1,2,3,4,5",
  scheduleTime: "09:00",
  timeZone: "",
  scheduleImage: "product",
  mixProduct: true,
  mixGuides: false,
  planDays: 7,
  refillDays: 0,
  notifyEmail: "",
  notifyFailure: "tell",
  notifyUpcoming: "weekly",
  toc: false,
  articleSchema: false,
  faqSchema: false,
  breadcrumbSchema: false,
  customIdeasPrompt: "",
  customContentPrompt: "",
  customEmailPrompt: "",
  refreshRules: DEFAULT_RULES,
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
  if (s.authorVoice.trim())
    parts.push(
      `AUTHOR VOICE (the article is written as ${s.defaultAuthor || "this author"}; layer these style traits on top of the store's voice, never as new facts, credentials or personal experience)\n${s.authorVoice.trim()}`,
    );
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
  if (kind === "content" && s.customEmailPrompt.trim())
    lines.push(
      `EMAIL INSTRUCTIONS FROM THE STORE (apply to email_subject and email_body only: tone, length, layout and any characters or words to use or avoid. They take priority over the default email format, but the fact rules still apply and the email must keep its single link to the article)\n${s.customEmailPrompt.trim()}`,
    );
  const custom = kind === "ideas" ? s.customIdeasPrompt : s.customContentPrompt;
  if (custom.trim())
    lines.push(
      `EXTRA INSTRUCTIONS FROM THE STORE (style, structure and focus only. They take priority over the default style and quality rules, but can NEVER override the fact rules: product data and merchant facts remain the only source of truth)\n${custom.trim()}`,
    );
  return lines.join("\n\n");
}
