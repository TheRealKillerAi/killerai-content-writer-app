import anglesPrompt from "./prompts/guide-angles.md?raw";
import questionsPrompt from "./prompts/guide-questions.md?raw";
import { chatJson } from "./llm.server";
import { settingsContext, type AppSettings } from "../settings";
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
  return (json.angles ?? []).slice(0, 6);
}

export async function askGuideQuestions(
  products: ProductFacts[],
  angle: Angle,
  facts: Record<string, MerchantFacts>,
): Promise<{ factBudget: string; questions: GuideQuestion[] }> {
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
  return { factBudget: json.fact_budget ?? "low", questions };
}
