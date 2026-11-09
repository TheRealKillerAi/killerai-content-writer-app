// Minimal, safe markdown -> HTML for previewing articles (headings, lists, bold, italics, links, paragraphs).
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s: string, productUrl: string) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((\/(?:collections|blogs)\/[a-z0-9_\/-]+)\)/g, (_m, t: string, u: string) => `<a href="${u}">${t}</a>`)
    .replace(/\[([^\]]+)\]\(\{\{PRODUCT_URL(?::([a-z0-9_-]+))?\}\}\)/g, (_m, t: string, h?: string) => `<a href="${esc(h ? `/products/${h}` : productUrl)}">${t}</a>`);
}

export const slug = (t: string) =>
  t.toLowerCase().replace(/\*\*/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "section";

/** H2 headings of the article, with unique anchor ids. */
export function tocEntries(md: string) {
  const used = new Set<string>();
  const out: { id: string; text: string }[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^##\s+(.*)$/);
    if (!m) continue;
    let id = slug(m[1]);
    for (let n = 2; used.has(id); n++) id = `${slug(m[1])}-${n}`;
    used.add(id);
    out.push({ id, text: m[1].replace(/\*\*/g, "") });
  }
  return out;
}

export function renderMarkdown(md: string, productUrl: string, withIds = false): string {
  const ids = withIds ? tocEntries(md).map((e) => e.id) : [];
  let h2 = 0;
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of md.split("\n")) {
    const im = line.match(/^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)\s*$/);
    if (im) {
      close();
      out.push(`<p><img src="${esc(im[2])}" alt="${esc(im[1])}" style="max-width:100%;height:auto"></p>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (h) {
      close();
      const n = Math.min(h[1].length, 4);
      const id = withIds && n === 2 ? ` id="${ids[h2++] ?? ""}"` : "";
      out.push(`<h${n}${id}>${inline(h[2], productUrl)}</h${n}>`);
    } else if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ul || ol)![1], productUrl)}</li>`);
    } else if (!line.trim()) {
      close();
    } else {
      close();
      out.push(`<p>${inline(line, productUrl)}</p>`);
    }
  }
  close();
  return out.join("\n");
}
