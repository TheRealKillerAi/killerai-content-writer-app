// Usage: DEEPSEEK_API_KEY=... node run.mjs ../products/laundry-ball.json [--angle N]
// Optional merchant answers: inputs/answers/<handle>.json  (a JSON object of question -> answer)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chat } from "./llm.mjs";
import readline from "node:readline/promises";
const judgeP = await readFile(new URL("./prompts/judge.md", import.meta.url), "utf8");
import { runChecks, loadReference, articleText, splitSentences, verifyLabels, cleanStructure, findRepeats, repairLink } from "./checks.mjs";
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
const handle40 = product.handle.slice(0, 40);
let unknown = JSON.parse(await readFile(here(`inputs/answers/${handle40}.unknown.json`), "utf8").catch(() => "[]"));
const ref = await loadReference(benchFiles);
const dir = `out/${product.handle.slice(0, 40)}`;
await mkdir(here(`./${dir}/`), { recursive: true });
const save = (name, obj) => writeFile(here(`./${dir}/${name}`), typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
const pd = JSON.stringify(product, null, 2);
const mkFacts = () => `PRODUCT DATA\n${pd}\n\nMERCHANT FACTS\n${answers}\n\nUNKNOWN TO THE MERCHANT (do not cover, estimate or hint at these)\n${JSON.stringify(unknown)}`;
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
let gaps = [...(angle.needs_info?.filter(Boolean) || []), ...unknown];
if (gaps.length) console.log(`Facts the data lacks for this angle (article will avoid them):\n - ${gaps.join("\n - ")}`);

if (!args.includes("--no-ask")) {
  console.log("Checking whether the data has enough facts for this angle...");
  const q = await call(questionsP, `${facts}\n\nCHOSEN ANGLE\n${JSON.stringify(angle)}`, 0.3);
  await save("1b-questions.json", q);
  console.log(`Fact budget: ${q.fact_budget}`);
  const qs = (q.questions || []).slice(0, 5);
  if (qs.length && q.fact_budget !== "good") {
    if (process.stdin.isTTY) {
      console.log("\nA few questions. Answer in ONE line (no line breaks) or press Enter to skip. Your answers become trusted product facts, so only say what you are sure of:\n");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const got = JSON.parse(answers); const skipped = [];
      for (const x of qs) {
        let ans = "";
        try { ans = (await rl.question(`? ${x.q}\n  > `)).trim(); } catch { /* input closed: treat as skipped */ }
        if (ans && !/^(i\s*)?(don'?t|do not)\s+(know|have)|^unknown$|^not sure$|^n\/a$|^\?$/i.test(ans)) got[x.q] = ans; else skipped.push(x.q);
      }
      rl.close();
      await mkdir(here("inputs/answers/"), { recursive: true });
      await writeFile(here(`inputs/answers/${product.handle.slice(0, 40)}.json`), JSON.stringify(got, null, 2));
      answers = JSON.stringify(got, null, 2);
      unknown = [...new Set([...unknown, ...skipped])];
      await writeFile(here(`inputs/answers/${handle40}.unknown.json`), JSON.stringify(unknown, null, 2));
      facts = mkFacts();
      gaps = [...(angle.needs_info?.filter(Boolean) || []), ...unknown];
    } else {
      console.log("Questions you could answer to improve it (run in a terminal to be asked):\n - " + qs.map((x) => x.q).join("\n - "));
    }
  }
}

console.log("2/5 Writing...");
const write = () => call(writerP, `VOICE GUIDE\n${voice}\n\n${facts}\n\nUNAVAILABLE FACTS\n${JSON.stringify(gaps)}\n\nCHOSEN ANGLE\n${JSON.stringify(angle)}\n\nSOURCES PROVIDED\nnone`, 0.6);
const audit = async (art) => {
  const sentences = splitSentences(art);
  const listing = (ss) => ss.map((x) => `${x.id}: ${x.text}`).join("\n");
  let raw = await call(auditP, `${facts}\n\nSENTENCES\n${listing(sentences)}`, 0);
  let res = verifyLabels(sentences, raw, facts, JSON.parse(answers));
  if (res.missing.length) {
    const rest = sentences.filter((x) => res.missing.includes(x.id));
    const raw2 = await call(auditP, `${facts}\n\nSENTENCES\n${listing(rest)}`, 0);
    raw = { labels: [...(raw.labels || []), ...(raw2.labels || [])], leaks: raw.leaks || [] };
    res = verifyLabels(sentences, raw, facts, JSON.parse(answers));
  }
  res.unsupported.push(...res.missing.map((id) => ({ text: sentences.find((x) => x.id === id).text, problem: "fact-checker did not review this sentence" })));
  return res;
};
const LINK = /\[[^\]]+\]\(\{\{PRODUCT_URL\}\}\)/;
const MASK = "⟦PRODUCT_LINK⟧";
const apply = (art, edits) => {
  let n = 0;
  const link = (art.body_markdown.match(LINK) || [null])[0];
  art.body_markdown = art.body_markdown.replace(LINK, MASK);
  const swap = (s) => { for (const e of edits) if (e.find && !e.find.includes("{{PRODUCT_URL}}") && s.includes(e.find)) { s = s.replace(e.find, e.replace ?? ""); n++; } return s; };
  art.tldr = swap(art.tldr); art.body_markdown = swap(art.body_markdown).replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  art.body_markdown = cleanStructure(art.body_markdown);
  if (link) art.body_markdown = art.body_markdown.replace(MASK, link);
  art.faq = art.faq.map((f) => ({ q: swap(f.q), a: swap(f.a) })).filter((f) => f.a.trim());
  return n;
};
let article = await write();

console.log("3/5 Auditing and fixing (up to 2 rounds)...");
let report = await audit(article);
const history = [report];
for (let round = 1; round <= 2; round++) {
  const repeats = findRepeats(article.body_markdown);
  const problems = { unsupported: report.unsupported, risky: report.risky, leaks: report.leaks, repetition: repeats };
  const count = problems.unsupported.length + problems.risky.length + problems.leaks.length + repeats.length;
  if (!count) break;
  console.log(`  round ${round}: ${count} problem(s)`);
  const fix = await call(fixerP, `ARTICLE\n${JSON.stringify({ tldr: article.tldr, body_markdown: article.body_markdown.replace(LINK, MASK), faq: article.faq }, null, 1)}\n\nPROBLEMS\n${JSON.stringify(problems, null, 1)}\n\n${facts}`, 0);
  const applied = apply(article, fix.edits || []);
  console.log(`  applied ${applied} edit(s)`);
  report = await audit(article); history.push(report);
}

console.log("4/5 Running code checks...");
{
  const name = product.title.split(/\s[–|-]\s/)[0];
  article.body_markdown = repairLink(article.body_markdown, name);
}
for (let i = 0; i < 2 && (article.title_tag.length > 60 || article.meta_description.length > 155); i++) {
  const t = await call("You shorten SEO fields. Return ONLY JSON {\"title_tag\":\"<=60 chars\",\"meta_description\":\"<=155 chars\"}. Keep the meaning and the key facts; do not add claims.", JSON.stringify({ title_tag: article.title_tag, meta_description: article.meta_description }), 0);
  article.title_tag = t.title_tag || article.title_tag; article.meta_description = t.meta_description || article.meta_description;
}
const checks = runChecks(article, ref);
const remaining = report.unsupported.length + report.risky.length + report.leaks.length + findRepeats(article.body_markdown).length;
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
