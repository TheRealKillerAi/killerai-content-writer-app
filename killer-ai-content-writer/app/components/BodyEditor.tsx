import { useEffect, useRef, useState } from "react";
import { useFilePicker } from "./useFilePicker";

/** HTML -> the markdown-style text the fact checks and word counts use. */
export function htmlToMarkdown(root: HTMLElement, productUrl: string): string {
  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/ /g, " ");
    if (!(node instanceof HTMLElement)) return "";
    const inner = Array.from(node.childNodes).map(inline).join("");
    switch (node.tagName) {
      case "BR":
        return "\n";
      case "IMG": {
        const src = node.getAttribute("src") ?? "";
        return /^https:\/\//.test(src) ? `![${(node.getAttribute("alt") ?? "").replace(/[\[\]]/g, "")}](${src})` : "";
      }
      case "STRONG":
      case "B":
        return inner.trim() ? `**${inner}**` : inner;
      case "EM":
      case "I":
        return inner.trim() ? `*${inner}*` : inner;
      case "A": {
        let href = node.getAttribute("href") ?? "";
        if (href === productUrl) href = "{{PRODUCT_URL}}";
        else {
          const pm = /^\/products\/([a-z0-9_-]+)$/.exec(href);
          if (pm) href = `{{PRODUCT_URL:${pm[1]}}}`;
        }
        return href && inner.trim() ? `[${inner}](${href})` : inner;
      }
      default:
        return inner;
    }
  };
  const blocks: string[] = [];
  const block = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? "").trim();
      if (t) blocks.push(t);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName;
    if (/^H[1-6]$/.test(tag)) blocks.push(`${"#".repeat(Number(tag[1]))} ${inline(node).trim()}`);
    else if (tag === "UL" || tag === "OL") {
      blocks.push(
        Array.from(node.children)
          .map((li, i) => `${tag === "UL" ? "-" : `${i + 1}.`} ${inline(li).trim()}`)
          .join("\n"),
      );
    } else if (tag === "DIV" && Array.from(node.children).some((c) => /^(H[1-6]|P|UL|OL|DIV)$/.test(c.tagName))) {
      Array.from(node.childNodes).forEach(block);
    } else {
      const t = inline(node).trim();
      if (t) blocks.push(t);
    }
  };
  Array.from(root.childNodes).forEach(block);
  return blocks.join("\n\n");
}

const ICON: Record<string, string> = {
  bold: "M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z",
  italic: "M10 5h8M6 19h8M14 5l-4 14",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5h.01",
  ul: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  ol: "M10 6h10M10 12h10M10 18h10M4 5l1.5-1v4M4 14c0-1 2.5-1 2.5.3S4 16 4 17h2.6",
  clear: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8",
  code: "M8 8l-4 4 4 4M16 8l4 4-4 4",
};

const Icon = ({ name }: { name: keyof typeof ICON }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={ICON[name]} />
  </svg>
);

const tool = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 34,
  height: 34,
  border: 0,
  borderRadius: 8,
  background: "transparent",
  color: "#303030",
  cursor: "pointer",
} as const;

const divider = <span style={{ width: 1, height: 22, background: "#e3e3e3", margin: "0 6px" }} />;

/** A Shopify-style rich text editor for the article body, with a switch to the HTML code behind it. */
export function BodyEditor({
  html,
  productUrl,
  onChange,
}: {
  html: string;
  productUrl: string;
  onChange: (html: string, markdown: string) => void;
}) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [code, setCode] = useState(html);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode === "visual" && ref.current) ref.current.innerHTML = html;
    // Set once per mode switch so typing never loses the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const emitHtml = (h: string) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = h;
    onChange(h, htmlToMarkdown(tmp, productUrl));
  };
  const emitVisual = () => ref.current && emitHtml(ref.current.innerHTML);
  const cmd = (name: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(name, false, value);
    emitVisual();
  };
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  const saved = useRef<Range | null>(null);
  const remember = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
  };
  const picker = useFilePicker((p) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel && saved.current) {
      sel.removeAllRanges();
      sel.addRange(saved.current);
    }
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    document.execCommand("insertHTML", false, `<p><img src="${esc(p.url)}" alt="${esc(p.alt)}" style="max-width:100%;height:auto"></p>`);
    emitVisual();
  });
  const T = ({ icon, title, run }: { icon: keyof typeof ICON; title: string; run: () => void }) => (
    <button type="button" title={title} aria-label={title} style={tool} onMouseDown={keep} onClick={run}>
      <Icon name={icon} />
    </button>
  );
  const addLink = () => {
    const url = window.prompt("Link address (https://…)", "https://");
    if (url && url !== "https://") cmd("createLink", url);
  };
  const toggle = () => {
    if (mode === "visual") {
      setCode(ref.current?.innerHTML ?? html);
      setMode("html");
    } else {
      setMode("visual");
    }
  };

  return (
    <div style={{ border: "1px solid #8a8a8a", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2, padding: "6px 8px", borderBottom: "1px solid #e3e3e3", background: "#fff" }}>
        {mode === "visual" ? (
          <>
            <select
              aria-label="Text style"
              defaultValue="p"
              onChange={(e) => {
                cmd("formatBlock", e.target.value);
                e.target.value = "p";
              }}
              style={{ height: 34, border: 0, background: "transparent", fontSize: 14, padding: "0 6px", cursor: "pointer", borderRadius: 8 }}
            >
              <option value="p">Paragraph</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
              <option value="h4">Heading 4</option>
            </select>
            {divider}
            <T icon="bold" title="Bold" run={() => cmd("bold")} />
            <T icon="italic" title="Italic" run={() => cmd("italic")} />
            {divider}
            <T icon="link" title="Link the selected words" run={addLink} />
            <button
              type="button"
              title="Insert image"
              aria-label="Insert image"
              style={{ ...tool, opacity: picker.busy ? 0.5 : 1 }}
              onMouseDown={(e) => {
                remember();
                keep(e);
              }}
              onClick={() => void picker.pick()}
            >
              <Icon name="image" />
            </button>
            {divider}
            <T icon="ul" title="Bulleted list" run={() => cmd("insertUnorderedList")} />
            <T icon="ol" title="Numbered list" run={() => cmd("insertOrderedList")} />
            {divider}
            <T icon="clear" title="Clear formatting" run={() => cmd("removeFormat")} />
          </>
        ) : (
          <span style={{ fontSize: 13, color: "#6a6a6a", padding: "0 6px" }}>This is the HTML that goes to your blog.</span>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          style={{ ...tool, background: mode === "html" ? "#1a1a1a" : "transparent", color: mode === "html" ? "#fff" : "#303030" }}
          title={mode === "html" ? "Back to the editor" : "Show the HTML code"}
          aria-label="Show or hide the HTML code"
          onMouseDown={keep}
          onClick={toggle}
        >
          <Icon name="code" />
        </button>
      </div>
      {picker.error ? <div style={{ padding: "6px 12px", color: "#c70a24", fontSize: 13 }}>{picker.error}</div> : null}
      <style>{`.ka-body h2{font-size:1.5em;margin:1em 0 .4em;font-weight:650}.ka-body h3{font-size:1.2em;margin:1em 0 .4em;font-weight:650}.ka-body p{margin:0 0 .9em}.ka-body ul,.ka-body ol{margin:0 0 .9em;padding-left:1.4em}.ka-body a{color:#005bd3;text-decoration:underline}.ka-body img{max-width:100%;height:auto;border-radius:6px}`}</style>
      {mode === "visual" ? (
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={emitVisual}
          className="ka-body"
          style={{ minHeight: 420, padding: "12px 16px", outline: "none", lineHeight: 1.65, fontSize: 15 }}
        />
      ) : (
        <textarea
          value={code}
          spellCheck={false}
          onChange={(e) => {
            setCode(e.target.value);
            emitHtml(e.target.value);
          }}
          style={{ width: "100%", minHeight: 420, boxSizing: "border-box", border: 0, padding: 16, outline: "none", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13, lineHeight: 1.55, resize: "vertical", display: "block" }}
        />
      )}
    </div>
  );
}
