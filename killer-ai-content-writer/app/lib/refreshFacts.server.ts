// AI Refresh: finds sentences about a linked product that no longer match the product's current data, and proposes a corrected sentence.
// The AI only points at differences and drafts the fix. Code then checks that the quoted evidence is really in the product data and that
// the fix adds no figure, colour or safety claim the data doesn't have. Anything that fails a check is dropped, never shown.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { chatJson, LlmError } from "./pipeline/llm.server";
import { plainText } from "./pipeline/checks";
import { getProduct } from "./products.server";
import { sentencesOf } from "./refreshChanges";
import type { AppSettings } from "./settings";

type Admin = AdminApiContext;
export type FactFix = { id: string; before: string; text: string; after: string; evidence: string; product: string };

const flat = (t: string) =>
  t
    .toLowerCase()
    .replace(/(\d)\s*[x×]\s*(?=\d)/g, "$1 ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
const numbersIn = (t: string) => (flat(t).match(/\d+(?: \d+)?/g) ?? []).flatMap((n) => n.split(" "));
const words = (t: string) => flat(t).split(" ").filter(Boolean);
const COLOURS = new Set("red blue green yellow purple pink black white grey gray brown beige navy teal turquoise silver orange".split(" "));
const CLAIMS = new Set("certified tested guaranteed warranty lifetime hypoallergenic antibacterial waterproof microwave freezer oven dishwasher biodegradable compostable organic vegan toxic bpa fda recyclable recycled".split(" "));

export function linkedProductHandles(bodyHtml: string): string[] {
  return [...new Set([...bodyHtml.matchAll(/\/products\/([a-z0-9][a-z0-9\-_%]*)/gi)].map((m) => decodeURIComponent(m[1]).toLowerCase()))].slice(0, 3);
}

export async function checkProductFacts(
  admin: Admin,
  post: { title: string; body: string },
  settings: Pick<AppSettings, "wordsToAvoid" | "neverMention" | "refreshInstructions">,
): Promise<{ ok: true; fixes: FactFix[]; products: string[]; checked: number } | { ok: false; message: string }> {
  try {
    const handles = linkedProductHandles(post.body);
    if (!handles.length) return { ok: false, message: "This post doesn't link to any of your products, so there is nothing to compare it with." };
    const loaded: { title: string; plain: string }[] = [];
    for (const h of handles) {
      const res = await admin.graphql(`#graphql query ByHandle($h: String!) { productByIdentifier(identifier: { handle: $h }) { id title status } }`, { variables: { h } });
      const p = (await res.json()).data?.productByIdentifier as { id: string; title: string; status: string } | null;
      if (!p || p.status !== "ACTIVE") continue;
      const prod = await getProduct(admin, p.id);
      if (prod) loaded.push({ title: p.title, plain: plainText([prod.facts]) });
    }
    if (!loaded.length) return { ok: false, message: "We couldn't read the product data for the products this post links to." };

    const sentences = sentencesOf(post.body)
      .filter((s) => words(s.text).length >= 6)
      .slice(0, 80)
      .map((s, i) => ({ ...s, id: `F${i + 1}` }));
    if (!sentences.length) return { ok: true, fixes: [], products: loaded.map((l) => l.title), checked: 0 };

    const data = loaded.map((l, i) => `PRODUCT ${i + 1}: ${l.title}\n${l.plain.slice(0, 6000)}`).join("\n\n");
    const hay = " " + flat(data) + " ";
    const guard = [
      settings.wordsToAvoid.trim() && `Words to avoid: ${settings.wordsToAvoid.trim()}`,
      settings.neverMention.trim() && `Never mention: ${settings.neverMention.trim()}`,
    ]
      .filter(Boolean)
      .join("\n");
    const r = await chatJson<{ fixes?: { id?: string; evidence?: string; corrected?: string }[] }>(
      `You compare an older blog post with the CURRENT data of the products it links to.
Find sentences in the post that state a specific fact about one of those products (size, material, count, colour, care, temperature, weight, what is included) that DIFFERS from the product data.
- Ignore sentences that match the data, and sentences about things the data doesn't mention (those can't be checked).
- Do not report opinions, advice or general statements.
- For each differing sentence give: "id" (as listed), "evidence" (words copied EXACTLY from the product data that show the difference) and "corrected" (the same sentence with ONLY the wrong fact changed, same voice, similar length).
- The corrected sentence may use only facts that are in the product data or already in the original sentence. Add no new claims, figures or colours.
- Write Australian English.
${guard}
Return ONLY JSON: {"fixes":[{"id":"F3","evidence":"...","corrected":"..."}]}. If nothing differs, return {"fixes":[]}.`,
      `${data}\n\nPOST SENTENCES\n${sentences.map((s) => `${s.id}: ${s.text}`).join("\n")}`,
      { temperature: 0.1 },
    );

    const fixes: FactFix[] = [];
    for (const f of r.json.fixes ?? []) {
      const s = sentences.find((x) => x.id === String(f.id));
      const corrected = String(f.corrected ?? "").replace(/\s+/g, " ").trim();
      const evidence = String(f.evidence ?? "").replace(/\s+/g, " ").trim();
      if (!s || s.html.includes("<") || !corrected || !evidence || corrected === s.text) continue; // only plain sentences can be swapped safely
      if (!hay.includes(" " + flat(evidence) + " ")) continue; // the evidence must really be in the product data
      const w0 = words(s.text).length;
      const w1 = words(corrected).length;
      if (w1 < w0 * 0.5 || w1 > w0 * 1.6) continue;
      const own = new Set([...numbersIn(s.text), ...numbersIn(data)]);
      if (numbersIn(corrected).some((n) => !own.has(n))) continue; // no figure that isn't in the data or the original
      const before = new Set(words(s.text));
      const cw = words(corrected);
      if (cw.filter((x) => COLOURS.has(x) && !hay.includes(" " + x + " ") && !before.has(x)).length) continue;
      if (cw.filter((x) => CLAIMS.has(x) && !before.has(x) && !hay.includes(" " + x.slice(0, 5))).length) continue;
      const keep = [...before].filter((x) => x.length >= 4);
      if (keep.length && keep.filter((x) => cw.includes(x)).length / keep.length < 0.5) continue; // must still be the same sentence
      const product = loaded.find((l) => flat(l.plain).includes(flat(evidence)))?.title ?? loaded[0].title;
      fixes.push({ id: `pf-${s.id}-${fixes.length}`, before: s.html, text: s.text, after: corrected, evidence, product });
    }
    return { ok: true, fixes, products: loaded.map((l) => l.title), checked: sentences.length };
  } catch (e) {
    console.error("product fact check failed", e);
    return { ok: false, message: e instanceof LlmError ? e.message : "Something went wrong. Please try again." };
  }
}
