// Usage: DEEPSEEK_API_KEY=... node run.mjs ../products/laundry-ball.json [--angle N]
// Optional merchant answers: inputs/answers/<handle>.json  (a JSON object of question -> answer)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chat } from "./llm.mjs";
import readline from "node:readline/promises";
const judgeP = await readFile(new URL("./prompts/judge.md", import.meta.url), "utf8");
import { runChecks, loadReference, articleText } from "./checks.mjs";
const here = (p) => new URL(p, import.meta.url);
const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".json"));
const forced = args.includes("--angle") ? Number(args[args.indexOf("--angle") + 1]) - 1 : null;
const product = JSON.parse(await readFile(file, "utf8"));
const [anglesP, writerP, auditP, fixerP, questionsP, voice, existing] = await Promise.all(
  ["prompts/angles.md", "prompts/writer.md", "prompts/auditor.md", "prompts/fixer.md", "prompts/questions.md", "voice/zwc-voice.md", "inputs/existing-articles.json"].map((p) => readFile(here(p), "utf8")),
);
let answers = await readFile(here(`inputs/answers/${product.handle.slice(0, 40)}.json`), "utf8").catch(() => "{}");
const benchFiles = JSON.parse(await readFile(here("inputs/benchmarks.json"), "utf8"))[product.handle.slice(0, 40)] || [];
const ref = await loadReference(benchFiles);
const dir = `out/${product.handle.slice(0, 40)}`;
await mkdir(here(`./${dir}/`), { recursive: true });
const save = (name, obj) => writeFile(here(`./${dir}/${name}`), typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
const pd = JSON.stringify(product, null, 2);
const mkFacts = () => `PRODUCT DATA\n${pd}\n\nMERCHANT FACTS\n${answers}`;
let facts = mkFacts();
let tokens = 0;
const call = async (sys, user, t) => { const r = await chat([{ role: "system", content: sys }, { role: "user", content: user }], { temperature: t }); tokens += r.usage?.total_tokens || 0; return r.json; };

console.log("1/5 Finding angles...");
const a = await call(anglesP, `PRODUCT DATA\n${pd}\n\nMERCHANT FACTS\n${answers}\n\nEXISTING ARTICLES\n${existing}`, 0.7);
await save("1-angles.json", a);
a.angles.forEach((x, i) => console.log(`  ${i + 1}. ${x.working_title} [answerable ${x.answerable_from_data}/3${x.needs_outside_evidence ? ", needs outside evidence" : ""}${x.risk === "high" ? ", HIGH-RISK topic" : ""}]`));
let idx = forced ?? a.angles.findIndex((x) => x.answerable_from_data >= 2 && !x.needs_outside_evidence && !x.overlaps_existing);
if (idx < 0) idx = 0;
const angle = a.angles[idx];
console.log(`Chosen (${forced !== null ? "your choice" : "most answerable"}): ${idx + 1}. ${angle.working_title}`);
let gaps = angle.needs_info?.filter(Boolean) || [];
if (gaps.length) console.log(`Facts the data lacks for this angle (article will avoid them):\n - ${gaps.join("\n - ")}`);

if (!args.includes("--no-ask")) {
  console.log("Checking whether the data has enough facts for this angle...");
  const q = await call(questionsP, `${facts}\n\nCHOSEN ANGLE\n${JSON.stringify(angle)}`, 0.3);
  await save("1b-questions.json", q);
  console.log(`Fact budget: ${q.fact_budget}`);
  const qs = (q.questions || []).slice(0, 5);
  if (qs.length && q.fact_budget !== "good") {
    if (process.stdin.isTTY) {
      console.log("\nA few questions (press Enter to skip any). Your answers become trusted product facts:\n");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const got = JSON.parse(answers); const skipped = [];
      for (const x of qs) {
        let ans = "";
        try { ans = (await rl.question(`? ${x.q}\n  > `)).trim(); } catch { /* input closed: treat as skipped */ }
        if (ans) got[x.q] = ans; else skipped.push(x.q);
      }
      rl.close();
      await mkdir(here("inputs/answers/"), { recursive: true });
      await writeFile(here(`inputs/answers/${product.handle.slice(0, 40)}.json`), JSON.stringify(got, null, 2));
      answers = JSON.stringify(got, null, 2); facts = mkFacts();
      gaps = skipped;
    } else {
      console.log("Questions you could answer to improve it (run in a terminal to be asked):\n - " + qs.map((x) => x.q).join("\n - "));
    }
  }
}

console.log("2/5 Writing...");
const write = () => call(writerP, `VOICE GUIDE\n${voice}\n\n${facts}\n\nUNAVAILABLE FACTS\n${JSON.stringify(gaps)}\n\nCHOSEN ANGLE\n${JSON.stringify(angle)}\n\nSOURCES PROVIDED\nnone`, 0.6);
const audit = (art) => call(auditP, `${facts}\n\nARTICLE\n# ${art.h1}\n${art.tldr}\n${art.body_markdown}\n${art.faq.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n")}`, 0);
const apply = (art, edits) => {
  let n = 0;
  const swap = (s) => { for (const e of edits) if (e.find && s.includes(e.find)) { s = s.replace(e.find, e.replace ?? ""); n++; } return s; };
  art.tldr = swap(art.tldr); art.body_markdown = swap(art.body_markdown);
  art.faq = art.faq.map((f) => ({ q: swap(f.q), a: swap(f.a) })).filter((f) => f.a.trim());
  return n;
};
let article = await write();

console.log("3/5 Auditing and fixing (up to 2 rounds)...");
let report = await audit(article);
const history = [report];
for (let round = 1; round <= 2; round++) {
  const problems = { unsupported: report.unsupported, risky: report.risky, leaks: report.leaks };
  const count = problems.unsupported.length + problems.risky.length + problems.leaks.length;
  if (!count) break;
  console.log(`  round ${round}: ${count} problem(s)`);
  const fix = await call(fixerP, `ARTICLE\n${JSON.stringify({ tldr: article.tldr, body_markdown: article.body_markdown, faq: article.faq }, null, 1)}\n\nPROBLEMS\n${JSON.stringify(problems, null, 1)}\n\n${facts}`, 0);
  const applied = apply(article, fix.edits || []);
  console.log(`  applied ${applied} edit(s)`);
  report = await audit(article); history.push(report);
}

console.log("4/5 Running code checks...");
const checks = runChecks(article, ref);
const remaining = report.unsupported.length + report.risky.length + report.leaks.length;
const status = remaining === 0 && checks.issues.length === 0 ? "READY FOR MERCHANT APPROVAL" : "NEEDS REVIEW";
await save("2-article.json", article);
await save("3-audit.json", { final: report, history });
await save("4-checks.json", { ...checks, status });
await save("article.md", `# ${article.h1}\n\n**TL;DR:** ${article.tldr}\n\n${article.body_markdown}\n\n## Frequently asked questions\n\n${article.faq.map((f) => `**${f.q}**\n${f.a}`).join("\n\n")}\n`);
let cmp = null;
if (benchFiles.length) {
  console.log("5/5 Comparing with your benchmark post(s)...");
  const refs = await Promise.all(benchFiles.map(async (f) => `--- BENCHMARK: ${f}\n${await readFile(here(f), "utf8")}`));
  cmp = await call(judgeP, `${refs.join("\n\n")}\n\n--- NEW ARTICLE\n${articleText(article)}\n\nPRODUCT DATA\n${pd}`, 0);
  await save("5-benchmark-comparison.json", cmp);
}
console.log(`Done. STATUS: ${status}`);
console.log(`Words: ${checks.words} | audit problems left: ${remaining} | tokens: ${tokens}`);
[...report.unsupported, ...report.risky, ...report.leaks].forEach((x) => console.log(` - AUDIT: ${(x.text || "").slice(0, 110)} -> ${(x.problem || "").slice(0, 90)}`));
checks.issues.forEach((i) => console.log(` - CHECK: ${i}`));
console.log(`Similarity to benchmark (information only): ${checks.similarity.sharedSevenWordRuns} shared 7-word runs`);
if (cmp) {
  const avg = (o) => (Object.values(o).filter((v) => typeof v === "number").reduce((a, b) => a + b, 0) / 6).toFixed(1);
  console.log(`Benchmark comparison: ${cmp.verdict.toUpperCase()} | new ${avg(cmp.new)}/5 vs ` + cmp.benchmarks.map((b) => `${b.name.split("/").pop()} ${avg(b)}/5`).join(", "));
  (cmp.biggest_gaps || []).forEach((g) => console.log(` - GAP: ${g}`));
}
console.log(`Files in prototype/v2/${dir}/`);
