import { useEffect, useRef, useState } from "react";

/** HTML -> the markdown-style text the fact checks and word counts use. */
export function htmlToMarkdown(root: HTMLElement, productUrl: string): string {
  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/ /g, " ");
    if (!(node instanceof HTMLElement)) return "";
    const inner = Array.from(node.childNodes).map(inline).join("");
    switch (node.tagName) {
      case "BR":
        return "\n";
      case "STRONG":
      case "B":
        return inner.trim() ? `**${inner}**` : inner;
      case "EM":
      case "I":
        return inner.trim() ? `*${inner}*` : inner;
      case "A": {
        let href = node.getAttribute("href") ?? "";
        if (href === productUrl) href = "{{PRODUCT_URL}}";
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

const btn = {
  padding: "4px 10px",
  border: "1px solid transparent",
  borderRadius: 6,
  background: "transparent",
  cursor: "pointer",
  fontSize: 13,
  minWidth: 30,
} as const;

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
  const B = ({ label, title, run, bold }: { label: string; title: string; run: () => void; bold?: boolean }) => (
    <button type="button" title={title} style={{ ...btn, fontWeight: bold ? 700 : 400 }} onMouseDown={keep} onClick={run}>
      {label}
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
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2, padding: 6, borderBottom: "1px solid #e3e3e3", background: "#f7f7f7" }}>
        {mode === "visual" ? (
          <>
            <B label="Paragraph" title="Normal text" run={() => cmd("formatBlock", "p")} />
            <B label="H2" title="Heading 2" run={() => cmd("formatBlock", "h2")} bold />
            <B label="H3" title="Heading 3" run={() => cmd("formatBlock", "h3")} bold />
            <span style={{ width: 1, height: 20, background: "#d4d4d4", margin: "0 4px" }} />
            <B label="B" title="Bold" run={() => cmd("bold")} bold />
            <button type="button" title="Italic" style={{ ...btn, fontStyle: "italic" }} onMouseDown={keep} onClick={() => cmd("italic")}>I</button>
            <button type="button" title="Underline" style={{ ...btn, textDecoration: "underline" }} onMouseDown={keep} onClick={() => cmd("underline")}>U</button>
            <span style={{ width: 1, height: 20, background: "#d4d4d4", margin: "0 4px" }} />
            <B label="• List" title="Bulleted list" run={() => cmd("insertUnorderedList")} />
            <B label="1. List" title="Numbered list" run={() => cmd("insertOrderedList")} />
            <span style={{ width: 1, height: 20, background: "#d4d4d4", margin: "0 4px" }} />
            <B label="Link" title="Link the selected words" run={addLink} />
            <B label="Unlink" title="Remove link" run={() => cmd("unlink")} />
            <B label="Clear" title="Clear formatting" run={() => cmd("removeFormat")} />
            <B label="↶" title="Undo" run={() => cmd("undo")} />
            <B label="↷" title="Redo" run={() => cmd("redo")} />
          </>
        ) : (
          <span style={{ fontSize: 13, color: "#6a6a6a", padding: "0 6px" }}>This is the HTML that goes to your blog.</span>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          style={{ ...btn, border: "1px solid #c9c9c9", background: mode === "html" ? "#1a1a1a" : "#fff", color: mode === "html" ? "#fff" : "#1a1a1a" }}
          title="Show or hide the HTML code"
          onMouseDown={keep}
          onClick={toggle}
        >
          {"<>"} {mode === "html" ? "Back to editor" : "Show HTML"}
        </button>
      </div>
      <style>{`.ka-body h2{font-size:1.5em;margin:1em 0 .4em;font-weight:650}.ka-body h3{font-size:1.2em;margin:1em 0 .4em;font-weight:650}.ka-body p{margin:0 0 .9em}.ka-body ul,.ka-body ol{margin:0 0 .9em;padding-left:1.4em}.ka-body a{color:#005bd3;text-decoration:underline}`}</style>
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
