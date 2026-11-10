// The rules AI Refresh follows. Shown to the merchant ("How AI Refresh decides") and switchable in Settings.
export type RuleMode = "on" | "flag" | "off";
export type RuleId = "dead_product" | "dead_collection" | "dead_post" | "product_stock" | "old_year" | "price";

export type RuleDef = {
  id: RuleId;
  name: string;
  /** What it looks for. */
  looksFor: string;
  /** What happens by default, in plain words. */
  action: string;
  risk: "Low" | "Medium";
  /** Can be applied to several posts at once (coming in a later release). */
  bulk: boolean;
  modes: RuleMode[];
  default: RuleMode;
};

export const RULES: RuleDef[] = [
  {
    id: "dead_product",
    name: "Links to products that are gone",
    looksFor: "A link to a product that no longer exists, or is a draft or archived.",
    action: "Suggests removing the link and keeping the words.",
    risk: "Low",
    bulk: true,
    modes: ["on", "flag", "off"],
    default: "on",
  },
  {
    id: "dead_collection",
    name: "Links to collections that are gone",
    looksFor: "A link to a collection that no longer exists.",
    action: "Suggests removing the link and keeping the words.",
    risk: "Low",
    bulk: true,
    modes: ["on", "flag", "off"],
    default: "on",
  },
  {
    id: "dead_post",
    name: "Links to posts that are gone",
    looksFor: "A link to a blog post that is missing or unpublished.",
    action: "Suggests removing the link and keeping the words.",
    risk: "Low",
    bulk: true,
    modes: ["on", "flag", "off"],
    default: "on",
  },
  {
    id: "product_stock",
    name: "Products that are out of stock",
    looksFor: "A link to a product that is out of stock right now.",
    action: "Points it out. Never changes anything, because stock is often temporary.",
    risk: "Low",
    bulk: false,
    modes: ["flag", "off"],
    default: "flag",
  },
  {
    id: "old_year",
    name: "Years that have passed",
    looksFor: "A past year in the title, search description or text.",
    action: "Points it out and says whether it reads like a 'best of 2023' claim or a piece of history ('we started in 2019'). Never changes it for you.",
    risk: "Medium",
    bulk: false,
    modes: ["flag", "off"],
    default: "flag",
  },
  {
    id: "price",
    name: "Prices in the text",
    looksFor: "A price written into the post, which may have changed.",
    action: "Points it out so you can check it against the product page. Never changes it for you.",
    risk: "Medium",
    bulk: false,
    modes: ["flag", "off"],
    default: "flag",
  },
];

export const DEFAULT_RULES = Object.fromEntries(RULES.map((r) => [r.id, r.default])) as Record<RuleId, RuleMode>;

/** Saved rule settings, cleaned up: unknown or missing rules get their default. */
export function cleanRules(raw?: Partial<Record<string, string>> | null): Record<RuleId, RuleMode> {
  const out = { ...DEFAULT_RULES };
  for (const r of RULES) {
    const v = raw?.[r.id];
    if (v && (r.modes as string[]).includes(v)) out[r.id] = v as RuleMode;
  }
  return out;
}

export const MODE_LABEL: Record<RuleMode, string> = { on: "Suggest a fix", flag: "Point it out only", off: "Off" };
