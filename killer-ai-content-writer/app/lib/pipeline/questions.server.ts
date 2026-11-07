import questionsPrompt from "./prompts/questions.md?raw";
import { chatJson } from "./llm.server";
import type { Angle, MerchantFacts, ProductFacts, Question } from "./types";

export async function askQuestions(
  product: ProductFacts,
  angle: Angle,
  facts: MerchantFacts,
): Promise<{ factBudget: string; questions: Question[] }> {
  const user = [
    `PRODUCT DATA\n${JSON.stringify(product, null, 2)}`,
    `MERCHANT FACTS\n${JSON.stringify(facts.known, null, 2)}`,
    `UNKNOWN TO THE MERCHANT\n${JSON.stringify(facts.unknown)}`,
    `CHOSEN ANGLE\n${JSON.stringify(angle)}`,
  ].join("\n\n");
  const { json } = await chatJson<{ fact_budget: string; questions: Question[] }>(questionsPrompt, user, {
    temperature: 0.3,
  });
  const asked = new Set([...Object.keys(facts.known), ...facts.unknown].map((q) => q.trim().toLowerCase()));
  const questions = (json.questions ?? [])
    .filter((x) => x?.q && !asked.has(x.q.trim().toLowerCase()))
    .slice(0, 5);
  return { factBudget: json.fact_budget ?? "low", questions };
}
