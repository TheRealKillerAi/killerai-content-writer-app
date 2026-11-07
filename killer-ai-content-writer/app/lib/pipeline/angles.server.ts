import anglesPrompt from "./prompts/angles.md?raw";
import { chatJson } from "./llm.server";
import { settingsContext, DEFAULT_SETTINGS, type AppSettings } from "../settings";
import type { Angle, ProductFacts } from "./types";

export async function findAngles(
  product: ProductFacts,
  existingTitles: string[],
  merchantFacts: Record<string, string> = {},
  settings: AppSettings = DEFAULT_SETTINGS,
): Promise<{ angles: Angle[]; tokens: number }> {
  const user = [
    `PRODUCT DATA\n${JSON.stringify(product, null, 2)}`,
    `MERCHANT FACTS\n${JSON.stringify(merchantFacts, null, 2)}`,
    `EXISTING ARTICLES\n${JSON.stringify(existingTitles)}`,
    settingsContext(settings, "ideas"),
  ].join("\n\n");
  const { json, tokens } = await chatJson<{ angles: Angle[] }>(anglesPrompt, user, { temperature: 0.7 });
  return { angles: (json.angles ?? []).slice(0, 6), tokens };
}
