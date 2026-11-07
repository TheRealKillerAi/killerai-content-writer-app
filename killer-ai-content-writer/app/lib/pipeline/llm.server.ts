// Thin, swappable model client. Today: DeepSeek (OpenAI-compatible). Swap this file to change provider.
const URL_ = process.env.DEEPSEEK_URL || "https://api.deepseek.com/chat/completions";

export class LlmError extends Error {}

export async function chatJson<T>(
  system: string,
  user: string,
  { temperature = 0.5 }: { temperature?: number } = {},
): Promise<{ json: T; tokens: number }> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new LlmError("DEEPSEEK_API_KEY is not set. Add it to the app's .env file and restart the dev server.");

  let lastStatus = 0;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        max_tokens: 8000,
        temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    lastStatus = res.status;
    if (res.ok) {
      const data = await res.json();
      const text = String(data.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "");
      try {
        return { json: JSON.parse(text) as T, tokens: data.usage?.total_tokens ?? 0 };
      } catch {
        throw new LlmError("The AI returned something that was not valid JSON. Please try again.");
      }
    }
    if (res.status < 500 && res.status !== 429) {
      throw new LlmError(`AI request failed (${res.status}).`);
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw new LlmError(`The AI service is busy (${lastStatus}). Please try again in a minute.`);
}
