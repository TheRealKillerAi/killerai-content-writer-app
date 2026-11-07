// Usage: DEEPSEEK_API_KEY=... node run.mjs ../products/laundry-ball.json [--angle N]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chat } from "./llm.mjs";
import { runChecks } from "./checks.mjs";
const here = (p) => new URL(p, import.meta.url);
const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".json"));
const pick = args.includes("--angle") ? Number(args[args.indexOf("--angle") + 1]) - 1 : 0;
const product = JSON.parse(await readFile(file, "utf8"));
const [anglesP, writerP, auditP, voice, existing] = await Promise.all(
  ["prompts/angles.md", "prompts/writer.md", "prompts/auditor.md", "voice/zwc-voice.md", "inputs/existing-articles.json"].map((p) => readFile(here(p), "utf8")),
);
const dir = `out/${product.handle.slice(0, 40)}`;
await mkdir(here(`./${dir}/`), { recursive: true });
const save = (name, obj) => writeFile(here(`./${dir}/${name}`), typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
const pd = JSON.stringify(product, null, 2);
let tokens = 0;

console.log("1/4 Finding angles...");
const a = await chat([{ role: "system", content: anglesP }, { role: "user", content: `PRODUCT DATA\n${pd}\n\nEXISTING ARTICLES\n${existing}` }], { temperature: 0.7 });
tokens += a.usage.total_tokens;
await save("1-angles.json", a.json);
a.json.angles.forEach((x, i) => console.log(`  ${i + 1}. ${x.working_title}  [${x.target_query}]${x.risk === "high" ? " (high-risk topic)" : ""}${x.overlaps_existing ? " (overlaps existing)" : ""}`));
const angle = a.json.angles[pick];
console.log(`Chosen: ${angle.working_title}`);

const write = async (extra = "") => {
  const r = await chat([{ role: "system", content: writerP }, { role: "user", content: `VOICE GUIDE\n${voice}\n\nPRODUCT DATA\n${pd}\n\nCHOSEN ANGLE\n${JSON.stringify(angle)}\n\nSOURCES PROVIDED\nnone${extra}` }], { temperature: 0.6 });
  tokens += r.usage.total_tokens; return r.json;
};
const audit = async (art) => {
  const r = await chat([{ role: "system", content: auditP }, { role: "user", content: `PRODUCT DATA\n${pd}\n\nARTICLE\n# ${art.h1}\n${art.tldr}\n${art.body_markdown}\n${art.faq.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n")}` }], { temperature: 0 });
  tokens += r.usage.total_tokens; return r.json;
};

console.log("2/4 Writing...");
let article = await write();
console.log("3/4 Auditing...");
let report = await audit(article);
let revisions = 0;
if (report.verdict !== "pass" && revisions < 1) {
  console.log("  Audit found problems, revising once...");
  const problems = JSON.stringify({ unsupported: report.unsupported, risky: report.risky, leaks: report.leaks }, null, 2);
  article = await write(`\n\nREVISION REQUIRED. A fact-checker found these problems in your previous draft. Rewrite the article fixing every one (remove or reword; do not add new unsupported claims):\n${problems}`);
  report = await audit(article); revisions++;
}
console.log("4/4 Running checks...");
const checks = runChecks(article);
await save("2-article.json", article);
await save("3-audit.json", report);
await save("4-checks.json", checks);
const md = `# ${article.h1}\n\n**TL;DR:** ${article.tldr}\n\n${article.body_markdown}\n\n## Frequently asked questions\n\n${article.faq.map((f) => `**${f.q}**\n${f.a}`).join("\n\n")}\n`;
await save("article.md", md);
console.log(`\nDone. Words: ${checks.words} | revisions: ${revisions} | audit verdict: ${report.verdict} | tokens: ${tokens}`);
console.log(`Unsupported: ${report.unsupported.length} | Risky: ${report.risky.length} | Leaks: ${report.leaks.length}`);
console.log(checks.issues.length ? "Check issues:\n - " + checks.issues.join("\n - ") : "All code checks passed.");
console.log(`Files in prototype/v2/${dir}/`);
