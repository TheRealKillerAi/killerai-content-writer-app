import db from "../db.server";
import { getAuthor } from "./authors.server";
import { getShopName } from "./products.server";
import { DEFAULT_SETTINGS, type AppSettings } from "./settings";
import { clampPx, isHex, TLDR_DEFAULTS } from "./tldr";

export async function loadSettings(shop: string): Promise<AppSettings> {
  const row = await db.shopSettings.findUnique({ where: { shop } });
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.data) as Partial<AppSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function validZone(z: string): boolean {
  if (!z) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

const text = (f: FormData, k: string, max: number) => String(f.get(k) ?? "").trim().slice(0, max);
const flag = (f: FormData, k: string) => f.get(k) !== null;

export function settingsFromForm(f: FormData): AppSettings {
  const maxWords = Number(f.get("maxWords"));
  const planDays = ([7, 14, 30] as const).find((d) => d === Number(f.get("planDays"))) ?? 7;
  return {
    brandDescription: text(f, "brandDescription", 2500),
    wordsToUse: text(f, "wordsToUse", 500),
    wordsToAvoid: text(f, "wordsToAvoid", 500),
    neverMention: text(f, "neverMention", 1000),
    businessName: text(f, "businessName", 120),
    whatYouSell: text(f, "whatYouSell", 400),
    audience: text(f, "audience", 400),
    blogId: text(f, "blogId", 80).startsWith("gid://shopify/Blog/") ? text(f, "blogId", 80) : "",
    defaultAuthor: "",
    defaultAuthorId: text(f, "defaultAuthorId", 40),
    authorBox: flag(f, "authorBox"),
    authorBio: "",
    authorTitle: "",
    authorUrl: "",
    authorPhoto: "",
    authorVoice: "",
    publishMode: f.get("publishMode") === "live" ? "live" : "draft",
    keywordsAsTags: flag(f, "keywordsAsTags"),
    linkToOtherArticles: flag(f, "linkToOtherArticles"),
    articleTemplate: text(f, "articleTemplate", 80),
    disclaimerEnabled: flag(f, "disclaimerEnabled"),
    disclaimerText: text(f, "disclaimerText", 400) || DEFAULT_SETTINGS.disclaimerText,
    language: "en-AU",
    maxWords: [600, 1000, 1500].includes(maxWords) ? maxWords : null,
    scheduleEnabled: flag(f, "scheduleEnabled"),
    scheduleDays:
      f.getAll("scheduleDay").map(String).filter((d) => /^[0-6]$/.test(d)).sort().join(",") || DEFAULT_SETTINGS.scheduleDays,
    scheduleTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(text(f, "scheduleTime", 5)) ? text(f, "scheduleTime", 5) : DEFAULT_SETTINGS.scheduleTime,
    timeZone: validZone(text(f, "timeZone", 60)) ? text(f, "timeZone", 60) : "",
    scheduleImage: f.get("scheduleImage") === "none" ? "none" : "product",
    mixProduct: flag(f, "mixProduct") || !flag(f, "mixGuides"), // at least one kind stays on
    mixGuides: flag(f, "mixGuides"),
    planDays,
    refillDays: [3, 7, 14].includes(Number(f.get("refillDays"))) && Number(f.get("refillDays")) < planDays ? Number(f.get("refillDays")) : 0,
    notifyEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(f, "notifyEmail", 120)) ? text(f, "notifyEmail", 120) : "",
    notifyFailure: f.get("notifyFailure") === "skip" ? "skip" : "tell",
    notifyUpcoming: f.get("notifyUpcoming") === "off" ? "off" : "weekly",
    toc: flag(f, "toc"),
    articleSchema: flag(f, "articleSchema"),
    faqSchema: flag(f, "faqSchema"),
    breadcrumbSchema: flag(f, "breadcrumbSchema"),
    customIdeasPrompt: text(f, "customIdeasPrompt", 1500),
    customContentPrompt: text(f, "customContentPrompt", 1500),
    customEmailPrompt: text(f, "customEmailPrompt", 1500),
    tldrEnabled: flag(f, "tldrEnabled"),
    tldrLabel: text(f, "tldrLabel", 30) || TLDR_DEFAULTS.tldrLabel,
    tldrBg: isHex(text(f, "tldrBg", 7)) ? text(f, "tldrBg", 7) : TLDR_DEFAULTS.tldrBg,
    tldrText: isHex(text(f, "tldrText", 7)) ? text(f, "tldrText", 7) : TLDR_DEFAULTS.tldrText,
    tldrCorners: f.get("tldrCorners") === "square" ? "square" : "rounded",
    tldrFontSize: clampPx(Number(f.get("tldrFontSize"))),
    tldrFont: ["serif", "sans", "mono"].includes(String(f.get("tldrFont"))) ? (String(f.get("tldrFont")) as "serif" | "sans" | "mono") : "theme",
  };
}

export async function saveSettings(shop: string, settings: AppSettings) {
  const data = JSON.stringify(settings);
  await db.shopSettings.upsert({ where: { shop }, create: { shop, data }, update: { data } });
}

type AdminLike = Parameters<typeof getShopName>[0];

/** Saved settings, with the store's own name filled in when the business name is blank. */
export async function loadEffectiveSettings(admin: AdminLike, shop: string): Promise<AppSettings> {
  const settings = await loadSettings(shop);
  if (!settings.businessName.trim()) settings.businessName = await getShopName(admin);
  settings.defaultAuthor = "";
  if (settings.defaultAuthorId) {
    const a = await getAuthor(shop, settings.defaultAuthorId);
    if (a) {
      settings.defaultAuthor = a.name;
      settings.authorBio = a.bio;
      settings.authorTitle = a.jobTitle;
      settings.authorUrl = a.profileUrl;
      settings.authorPhoto = a.photoUrl;
      settings.authorVoice = a.voice;
    }
  }
  return settings;
}
