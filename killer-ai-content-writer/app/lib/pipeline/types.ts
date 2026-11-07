export type ProductFacts = {
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  tags: string[];
  options: { name: string; values: string[] }[];
  description_html: string;
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
