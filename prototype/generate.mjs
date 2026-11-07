// Usage: DEEPSEEK_API_KEY=... node generate.mjs products/laundry-ball.json "keyword idea"
import { readFile, writeFile } from "node:fs/promises";
const [file, keyword = ""] = process.argv.slice(2);
if (!process.env.DEEPSEEK_API_KEY || !file) {
  console.error("Set DEEPSEEK_API_KEY and pass a product JSON file."); process.exit(1);
}
const system = await readFile(new URL("./system-prompt.md", import.meta.url), "utf8");
const product = await readFile(file, "utf8");
const user = `PRODUCT DATA\n${product}\n\nTARGET KEYWORD (merchant-chosen, may be empty): ${keyword}\n\nWrite the full output now.`;
const res = await fetch("https://api.deepseek.com/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
  body: JSON.stringify({ model: "deepseek-chat", temperature: 0.6, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
});
if (!res.ok) { console.error(res.status, await res.text()); process.exit(1); }
const data = await res.json();
const out = `out/${JSON.parse(product).handle.slice(0, 40)}.md`;
await writeFile(new URL(`./${out}`, import.meta.url), data.choices[0].message.content);
console.log("Wrote", out, "| tokens:", JSON.stringify(data.usage));
