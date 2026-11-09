import anglesPrompt from "./prompts/angles.md?raw";
import { chatJson } from "./llm.server";
import { settingsContext, DEFAULT_SETTINGS, type AppSettings } from "../settings";
import { screenAgainstFacts } from "./screen.server";
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
  const angles = (json.angles ?? []).slice(0, 6).map((a) => ({ ...a, needs_info: Array.isArray(a.needs_info) ? a.needs_info : [] }));
  // A topic is only "missing" details the store's own data does not already hold. This matters for autopilot, which skips topics with too many gaps,
  // and for the writer, which is told never to cover anything listed as missing.
  const screened = await screenAgainstFacts(product, merchantFacts, angles.flatMap((a) => a.needs_info));
  const open = new Set(screened.open);
  for (const a of angles) a.needs_info = a.needs_info.filter((x) => open.has(x.trim()));
  return { angles, tokens: tokens + screened.tokens };
}
