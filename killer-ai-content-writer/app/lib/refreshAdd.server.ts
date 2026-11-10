// AI Refresh, stage 3: writing a TL;DR or an FAQ for an old post using ONLY what the post itself says.
// The AI must quote the post for every answer and code checks the quote is really there; any figure in the result must already be in the post.
import { chatJson, LlmError } from "./pipeline/llm.server";
import type { AppSettings } from "./settings";

const strip = (h: string) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|h[1-6]|li|div)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n").trim();
const flat = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const numbersIn = (t: string) => (t.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

const RULES_COMMON = `- Use ONLY what the post says. Add no facts, names, numbers, dates, claims or advice that are not in the post.
- Keep the author's voice. Write Australian English. Plain text only: no HTML, no markdown.`;

const guard = (s: Pick<AppSettings, "wordsToAvoid" | "neverMention" | "refreshInstructions">) =>
  [
    s.wordsToAvoid.trim() && `Words to avoid: ${s.wordsToAvoid.trim()}`,
    s.neverMention.trim() && `Never mention: ${s.neverMention.trim()}`,
    s.refreshInstructions.trim() && `Style instructions from the store owner (style only, they never override the rules above): ${s.refreshInstructions.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");

export async function writeTldr(title: string, bodyHtml: string, settings: AppSettings): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const text = strip(bodyHtml);
  try {
    const r = await chatJson<{ tldr?: string }>(
      `You write a TL;DR for the top of a blog post: 2 or 3 sentences, 25 to 60 words, answering the post's main question straight away.\n${RULES_COMMON}\n- Do not start with "TL;DR" and do not repeat the title.\n${guard(settings)}\nReturn ONLY JSON: {"tldr":"..."}`,
      `TITLE: ${title}\n\nPOST\n${text.slice(0, 12000)}`,
      { temperature: 0.2 },
    );
    const out = String(r.json.tldr ?? "").replace(/^\s*tl;?dr\s*[:\-–—]?\s*/i, "").replace(/\s+/g, " ").trim();
    if (!out) return { ok: false, message: "We couldn't write a summary for this post." };
    const n = words(out);
    if (n < 15 || n > 90) return { ok: false, message: "The summary came out the wrong length, so we dropped it. Please try again." };
    const allowed = new Set(numbersIn(text + " " + title));
    const stray = numbersIn(out).filter((x) => !allowed.has(x));
    if (stray.length) return { ok: false, message: `The summary included ${stray.join(", ")}, which isn't in the post, so we dropped it. Please try again.` };
    return { ok: true, text: out };
  } catch (e) {
    console.error("tldr failed", e);
    return { ok: false, message: e instanceof LlmError ? e.message : "Something went wrong. Please try again." };
  }
}

export async function writeFaq(title: string, bodyHtml: string, settings: AppSettings): Promise<{ ok: true; items: { q: string; a: string }[] } | { ok: false; message: string }> {
  const text = strip(bodyHtml);
  try {
    const r = await chatJson<{ items?: { q?: string; a?: string; quote?: string }[] }>(
      `You write an FAQ for the end of a blog post: up to 5 questions a reader of THIS post would really ask, each answered in 1 to 3 sentences (under 60 words).\n${RULES_COMMON}\n- A question is only allowed if the post clearly answers it. If the post answers fewer than 3, return fewer. Never pad.\n- Questions are written the way a person would ask them and end with a question mark. Do not repeat a question the post already asks as a heading.\n- For each item give "quote": 8 to 40 words copied EXACTLY, word for word, from the post, that the answer rests on.\n${guard(settings)}\nReturn ONLY JSON: {"items":[{"q":"...","a":"...","quote":"..."}]}`,
      `TITLE: ${title}\n\nPOST\n${text.slice(0, 12000)}`,
      { temperature: 0.2 },
    );
    const hay = " " + flat(text) + " ";
    const allowed = new Set(numbersIn(text));
    const seen = new Set<string>();
    const items = (r.json.items ?? [])
      .map((x) => ({ q: String(x.q ?? "").replace(/\s+/g, " ").trim(), a: String(x.a ?? "").replace(/\s+/g, " ").trim(), quote: flat(String(x.quote ?? "")) }))
      .filter((x) => {
        if (!x.q.endsWith("?") || words(x.a) < 5 || words(x.a) > 70) return false;
        if (x.quote.split(" ").length < 6 || !hay.includes(" " + x.quote + " ")) return false; // the quote must really be in the post
        if (numbersIn(x.a).some((n) => !allowed.has(n))) return false; // no figure that isn't in the post
        const key = flat(x.q);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5)
      .map(({ q, a }) => ({ q, a }));
    if (items.length < 2) return { ok: false, message: "This post doesn't say enough to answer readers' questions honestly, so we haven't added an FAQ." };
    return { ok: true, items };
  } catch (e) {
    console.error("faq failed", e);
    return { ok: false, message: e instanceof LlmError ? e.message : "Something went wrong. Please try again." };
  }
}
