export type ProductFacts = {
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  tags: string[];
  options: { name: string; values: string[] }[];
  description_html: string;
  category?: string;
  /** Weight recorded in the store for each variant (may include packaging). */
  variant_weights?: { variant: string; weight: string }[];
  /** Custom product fields the merchant has set (size, material, care and so on). */
  details?: { name: string; value: string }[];
};

export type Angle = {
  working_title: string;
  target_query: string;
  intent: "informational" | "commercial";
  why_it_fits: string;
  answerable_from_data: number;
  needs_outside_evidence: boolean;
  needs_info: string[];
  risk: "normal" | "high";
  overlaps_existing: boolean;
};

export interface Question { q: string; why: string }
export interface MerchantFacts {
  /** question -> answer, trusted facts */
  known: Record<string, string>;
  /** questions the merchant said they don't know; never asked again, never covered */
  unknown: string[];
}

export interface Article {
  h1: string;
  title_tag: string;
  meta_description: string;
  handle: string;
  tldr: string;
  excerpt?: string;
  featured_image?: { url: string; alt: string };
  body_markdown: string;
  body_html?: string; // set once the merchant edits the body visually or as HTML; used instead of body_markdown when sending
  guide?: boolean; // a buying guide that links several products
  organization?: { author: string; blogId: string; tags: string; templateSuffix: string };
  faq: { q: string; a: string }[];
  missing_info_for_merchant?: string[];
  image_prompts?: string[];
  social_post?: string;
  email_subject?: string;
  email_body?: string;
}

export interface AuditProblem { text: string; problem: string; category?: string }
export interface AuditReport {
  unsupported: AuditProblem[];
  risky: AuditProblem[];
  leaks: AuditProblem[];
  missing: string[];
}
export interface ArticleResult {
  article: Article;
  status: "READY FOR MERCHANT APPROVAL" | "NEEDS REVIEW";
  words: number;
  issues: string[];
  remaining: AuditProblem[];
  tokens: number;
  /** How long the whole write took, start to finish. */
  seconds?: number;
  edited?: boolean;
  /** Flagged sentences the merchant has confirmed or chosen to ignore (the audit trail also lives in the SentenceReview table). */
  reviewed?: ReviewedSentence[];
  sent?: SentInfo;
}

export interface ReviewedSentence {
  text: string;
  problem: string;
  decision: "accepted" | "ignored";
  by: string;
  at: string;
  /** True when an earlier accepted decision was reused instead of asking again. */
  remembered?: boolean;
}

export interface SentInfo {
  id: string; // gid://shopify/Article/...
  published: boolean;
  at: string;
  handle: string;
  blogHandle: string;
  url: string | null; // where the article lives on the storefront (public once published)
}
