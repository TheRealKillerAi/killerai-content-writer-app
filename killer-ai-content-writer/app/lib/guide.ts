/** A buying guide covers several products. Its angles and articles are stored under one key built from the product ids. */
export const MAX_GUIDE_PRODUCTS = 8;
export const guideKey = (ids: string[]) => `guide:${[...new Set(ids)].sort().join("-")}`;
export const parseGuideKey = (key: string): string[] | null =>
  key.startsWith("guide:") ? key.slice(6).split("-").filter(Boolean) : null;
/** The product id to use for things that need a single product (images, default link). */
export const firstProductId = (key: string) => parseGuideKey(key)?.[0] ?? key;
