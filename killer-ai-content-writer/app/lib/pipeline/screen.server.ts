import screenPrompt from "./prompts/screen.md?raw";
import { chatJson } from "./llm.server";
import type { ProductFacts } from "./types";

// Same idea as the article audit: the AI must quote its evidence and code confirms the quote really exists.
const flat = (t: string) =>
  t
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&#39;|&quot;/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const STOP = new Set(
  "what which that this with from have your does should about when where there their they them will would could how are the and for you can any all not but its our out use used using more most some such only each into also".split(" "),
);
const content = (t: string) => flat(t).split(" ").filter((w) => w.length >= 4 && !STOP.has(w));

export type Screened = { open: string[]; answered: { item: string; evidence: string }[]; tokens: number };

/**
 * Splits items (questions for the owner, or details an angle says it is missing) into those still open and
 * those the store's own product data or earlier answers already cover. If anything is uncertain the item stays open.
 */
export async function screenAgainstFacts(product: ProductFacts, known: Record<string, string>, items: string[]): Promise<Screened> {
  const list = [...new Set(items.map((i) => i.trim()).filter(Boolean))];
  if (!list.length) return { open: [], answered: [], tokens: 0 };
  let json: { results?: { id: number; answered?: boolean; evidence?: string }[] };
  let tokens = 0;
  try {
    const r = await chatJson<typeof json>(
      screenPrompt,
      `PRODUCT DATA\n${JSON.stringify(product, null, 2)}\n\nMERCHANT FACTS\n${JSON.stringify(known, null, 2)}\n\nITEMS\n${list.map((q, i) => `${i + 1}. ${q}`).join("\n")}`,
      { temperature: 0 },
    );
    json = r.json;
    tokens = r.tokens;
  } catch (e) {
    console.error("Could not screen questions against the product data", e);
    return { open: list, answered: [], tokens };
  }
  // Only the data itself counts as a place to find evidence (not the questions that were asked).
  const hay = " " + flat([JSON.stringify(product), ...Object.values(known)].join(" ")) + " ";
  const byId = new Map((json.results ?? []).map((x) => [Number(x.id), x]));
  const open: string[] = [];
  const answered: Screened["answered"] = [];
  list.forEach((item, i) => {
    const res = byId.get(i + 1);
    const quote = flat(String(res?.evidence ?? ""));
    const real = !!res?.answered && quote.split(" ").length >= 2 && hay.includes(" " + quote + " ");
    // The passage must also be about what the item asks (shares an important word with it).
    // A quote from a custom field (for example "stainless steel" from Material) also counts as being about the field's name.
    const fieldNames = (product.details ?? [])
      .filter((d) => flat(d.value) && (quote.includes(flat(d.value)) || flat(d.value).includes(quote)))
      .map((d) => d.name)
      .join(" ");
    const ev = content(quote + " " + fieldNames).map((w) => w.slice(0, 4));
    // Word matching alone misses synonyms ("made from" / "Material"), so a custom-field value or a longer passage also counts.
    const related = content(item).some((w) => ev.includes(w.slice(0, 4))) || !!fieldNames || quote.split(" ").length >= 4;
    if (real && related) answered.push({ item, evidence: String(res?.evidence ?? "") });
    else open.push(item);
  });
  return { open, answered, tokens };
}
