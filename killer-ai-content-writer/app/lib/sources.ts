// Which websites AI Refresh may rely on when it checks a fact. Pure code, shared by server and screen.
// Rule (owner, 10 Nov 2026): only reliable sources, and always show them so the merchant can judge.

/** Never searched, never shown, never relied on: social media, forums and Q&A, personal blog platforms and user-edited wikis. */
export const BLOCKED_DOMAINS = [
  "instagram.com", "facebook.com", "fb.com", "x.com", "twitter.com", "tiktok.com", "pinterest.com", "pinterest.com.au", "reddit.com", "quora.com",
  "youtube.com", "youtu.be", "linkedin.com", "threads.net", "snapchat.com", "tumblr.com", "medium.com", "substack.com", "blogspot.com", "wordpress.com",
  "wikipedia.org", "wikihow.com", "fandom.com", "answers.com", "yahoo.com", "ask.com", "stackexchange.com", "stackoverflow.com", "whatsapp.com", "telegram.org",
];

export type SourceType = "government" | "university" | "international" | "news" | "research" | "other";

export const SOURCE_LABEL: Record<SourceType, string> = {
  government: "Government",
  university: "University",
  international: "International body",
  news: "News organisation",
  research: "Research journal",
  other: "Other website (not checked)",
};

const NEWS = [
  "abc.net.au", "sbs.com.au", "theguardian.com", "bbc.com", "bbc.co.uk", "reuters.com", "apnews.com", "nytimes.com", "washingtonpost.com", "smh.com.au",
  "theage.com.au", "afr.com", "theaustralian.com.au", "canberratimes.com.au", "brisbanetimes.com.au", "news.com.au", "9news.com.au", "7news.com.au",
  "theconversation.com", "cnn.com", "ft.com", "bloomberg.com", "npr.org", "aljazeera.com", "nbcnews.com", "cbc.ca", "rnz.co.nz", "stuff.co.nz", "nzherald.co.nz",
  "economist.com", "wsj.com", "independent.co.uk", "telegraph.co.uk",
];
const RESEARCH = ["nature.com", "science.org", "sciencedirect.com", "springer.com", "wiley.com", "thelancet.com", "plos.org", "cell.com", "tandfonline.com", "sciencemag.org"];
const INTERNATIONAL = ["un.org", "who.int", "oecd.org", "worldbank.org", "unep.org", "wto.org", "imf.org", "iso.org"];

const onDomain = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith("." + d));

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isBlocked(url: string): boolean {
  const h = hostOf(url);
  return !h || onDomain(h, BLOCKED_DOMAINS);
}

export function classifySource(url: string): { domain: string; type: SourceType; trusted: boolean } {
  const h = hostOf(url);
  let type: SourceType = "other";
  if (/(^|\.)gov$|\.gov\.[a-z]{2}$|\.govt\.nz$|\.gc\.ca$|\.gouv\.[a-z]{2}$|(^|\.)europa\.eu$|(^|\.)mil$/.test(h)) type = "government";
  else if (/(^|\.)edu$|\.edu\.[a-z]{2}$|\.ac\.[a-z]{2}$/.test(h)) type = "university";
  else if (/\.int$/.test(h) || onDomain(h, INTERNATIONAL)) type = "international";
  else if (onDomain(h, RESEARCH)) type = "research";
  else if (onDomain(h, NEWS)) type = "news";
  return { domain: h, type, trusted: type !== "other" };
}
