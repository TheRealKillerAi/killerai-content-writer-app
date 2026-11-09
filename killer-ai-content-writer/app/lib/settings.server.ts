import db from "../db.server";
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

const text = (f: FormData, k: string, max: number) => String(f.get(k) ?? "").trim().slice(0, max);
const flag = (f: FormData, k: string) => f.get(k) !== null;

export function settingsFromForm(f: FormData): AppSettings {
  const maxWords = Number(f.get("maxWords"));
  return {
    brandDescription: text(f, "brandDescription", 2500),
    wordsToUse: text(f, "wordsToUse", 500),
    wordsToAvoid: text(f, "wordsToAvoid", 500),
    neverMention: text(f, "neverMention", 1000),
    businessName: text(f, "businessName", 120),
    whatYouSell: text(f, "whatYouSell", 400),
    audience: text(f, "audience", 400),
    blogId: text(f, "blogId", 80).startsWith("gid://shopify/Blog/") ? text(f, "blogId", 80) : "",
    defaultAuthor: text(f, "defaultAuthor", 80),
    publishMode: f.get("publishMode") === "live" ? "live" : "draft",
    keywordsAsTags: flag(f, "keywordsAsTags"),
    linkToOtherArticles: flag(f, "linkToOtherArticles"),
    articleTemplate: text(f, "articleTemplate", 80),
    language: "en-AU",
    maxWords: [600, 1000, 1500].includes(maxWords) ? maxWords : null,
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
  return settings;
}
