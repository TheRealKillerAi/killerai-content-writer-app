import anglesPrompt from "./prompts/guide-angles.md?raw";
import questionsPrompt from "./prompts/guide-questions.md?raw";
import { chatJson } from "./llm.server";
import { settingsContext, type AppSettings } from "../settings";
import { screenAgainstFacts } from "./screen.server";
import type { Angle, MerchantFacts, ProductFacts } from "./types";

export type GuideQuestion = { product: string; q: string; why: string };

export async function findGuideAngles(
  products: ProductFacts[],
  existingTitles: string[],
  facts: Record<string, MerchantFacts>,
  settings: AppSettings,
): Promise<Angle[]> {
  const known = Object.fromEntries(Object.entries(facts).map(([h, f]) => [h, f.known]));
  const user = [
    `PRODUCT DATA\n${JSON.stringify(products, null, 2)}`,
    `MERCHANT FACTS (by product handle)\n${JSON.stringify(known, null, 2)}`,
    `EXISTING ARTICLES\n${JSON.stringify(existingTitles)}`,
    settingsContext(settings, "ideas"),
  ].join("\n\n");
  const { json } = await chatJson<{ angles: Angle[] }>(anglesPrompt, user, { temperature: 0.7 });
  const angles = (json.angles ?? []).slice(0, 6).map((a) => ({ ...a, needs_info: Array.isArray(a.needs_info) ? a.needs_info : [] }));
  // A guide is only missing details that none of its products' own data already holds.
  const all: ProductFacts = {
    ...products[0],
    title: products.map((p) => p.title).join(" / "),
    description_html: products.map((p) => p.description_html).join("\n"),
    tags: products.flatMap((p) => p.tags),
    options: products.flatMap((p) => p.options),
    details: products.flatMap((p) => p.details ?? []),
    variant_weights: products.flatMap((p) => p.variant_weights ?? []),
  };
  const screened = await screenAgainstFacts(all, Object.assign({}, ...Object.values(known)), angles.flatMap((a) => a.needs_info));
  const open = new Set(screened.open);
  for (const a of angles) a.needs_info = a.needs_info.filter((x) => open.has(x.trim()));
  return angles;
}

export async function askGuideQuestions(
  products: ProductFacts[],
  angle: Angle,
  facts: Record<string, MerchantFacts>,
): Promise<{ factBudget: string; questions: GuideQuestion[]; alreadyKnown: string[] }> {
  const user = [
    `PRODUCT DATA\n${JSON.stringify(products, null, 2)}`,
    `MERCHANT FACTS (by product handle; known answers, then questions the owner doesn't know)\n${JSON.stringify(
      Object.fromEntries(Object.entries(facts).map(([h, f]) => [h, { known: f.known, unknown: f.unknown }])),
      null,
      2,
    )}`,
    `CHOSEN ANGLE\n${JSON.stringify(angle)}`,
  ].join("\n\n");
  const { json } = await chatJson<{ fact_budget: string; questions: GuideQuestion[] }>(questionsPrompt, user, { temperature: 0.3 });
  const handles = new Set(products.map((p) => p.handle));
  const asked = (h: string) => new Set([...Object.keys(facts[h]?.known ?? {}), ...(facts[h]?.unknown ?? [])].map((q) => q.trim().toLowerCase()));
  const questions = (json.questions ?? [])
    .filter((x) => x?.q && handles.has(x.product) && !asked(x.product).has(x.q.trim().toLowerCase()))
    .slice(0, 8);
  // Check each question against its own product's data and earlier answers before the owner sees it.
  const kept: GuideQuestion[] = [];
  const dropped: string[] = [];
  for (const p of products) {
    const mine = questions.filter((x) => x.product === p.handle);
    if (!mine.length) continue;
    const screened = await screenAgainstFacts(p, facts[p.handle]?.known ?? {}, mine.map((x) => x.q));
    const open = new Set(screened.open);
    kept.push(...mine.filter((x) => open.has(x.q.trim())));
    dropped.push(...screened.answered.map((a) => `${p.title}: ${a.item}`));
  }
  return { factBudget: json.fact_budget ?? "low", questions: kept, alreadyKnown: dropped };
}
