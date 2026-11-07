// Deterministic checks. The AI does not get to grade these.
const LEAKS = /product (data|information)|according to the (data|information)|store currency|example\.com|\bUNVERIFIED\b|\[(INTERNAL|EXTERNAL)/i;
export function runChecks(a) {
  const words = (a.tldr + " " + a.body_markdown + " " + a.faq.map((f) => f.q + " " + f.a).join(" ")).split(/\s+/).filter(Boolean).length;
  const productLinks = (a.body_markdown.match(/\{\{PRODUCT_URL\}\}/g) || []).length;
  const otherLinks = (a.body_markdown.match(/\]\((?!\{\{PRODUCT_URL\}\})[^)]+\)/g) || []).length;
  const h2 = (a.body_markdown.match(/^## /gm) || []).length;
  const all = [a.h1, a.tldr, a.body_markdown, ...a.faq.map((f) => f.a)].join("\n");
  const issues = [];
  if (a.title_tag.length > 60) issues.push(`title_tag is ${a.title_tag.length} chars (max 60)`);
  if (a.meta_description.length > 155) issues.push(`meta_description is ${a.meta_description.length} chars (max 155)`);
  if (productLinks !== 1) issues.push(`expected exactly 1 product link token, found ${productLinks}`);
  if (otherLinks) issues.push(`${otherLinks} unexpected link(s)`);
  if (h2 < 3) issues.push(`only ${h2} H2 headings`);
  if (a.faq.length < 3) issues.push(`only ${a.faq.length} FAQ items`);
  if (LEAKS.test(all)) issues.push(`leaked wording: ${all.match(LEAKS)[0]}`);
  if (/\$\s?\d/.test(all)) issues.push("mentions a price");
  return { words, h2, productLinks, issues };
}
