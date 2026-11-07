const URL_ = "https://api.deepseek.com/chat/completions";
export async function chat(messages, { temperature = 0.5 } = {}) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("Set DEEPSEEK_API_KEY");
  let res;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      res = await fetch(URL_, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || "deepseek-chat", temperature, messages, response_format: { type: "json_object" } }),
      });
      if (res.ok) break;
      if (res.status < 500 && res.status !== 429) throw new Error(`${res.status} ${await res.text()}`);
    } catch (e) {
      if (attempt === 5 || /^4\d\d /.test(e.message)) throw e;
    }
    console.error(`  attempt ${attempt} failed, retrying...`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  if (!res?.ok) throw new Error(`LLM failed: ${res?.status}`);
  const data = await res.json();
  const text = data.choices[0].message.content.replace(/^```(?:json)?\s*|\s*```$/g, "");
  return { json: JSON.parse(text), usage: data.usage };
}
