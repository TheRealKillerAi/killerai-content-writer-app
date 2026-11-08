import { useEffect, useRef } from "react";
import { linkedHtml } from "../lib/articleHtml";

/** Converts the editor's HTML back to our markdown-link text. */
function toMarkdown(root: HTMLElement): string {
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    const inner = Array.from(node.childNodes).map(walk).join("");
    switch (node.tagName) {
      case "BR":
        return "\n";
      case "A": {
        const href = node.getAttribute("href") ?? "";
        return href && inner.trim() ? `[${inner}](${href})` : inner;
      }
      case "DIV":
      case "P":
        return `\n${inner}`;
      default:
        return inner;
    }
  };
  return Array.from(root.childNodes).map(walk).join("").replace(/^\n/, "").replace(/ /g, " ");
}

/**
 * A small rich-text box: shows real hyperlinks, lets you select words and link them to the article.
 * `value` is markdown-style text, `url` the address links point to, `onChange` gets the new text.
 */
export function RichCopy({
  label,
  value,
  url,
  rows,
  onChange,
}: {
  label: string;
  value: string;
  url: string;
  rows: number;
  onChange: (md: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Set once on mount (the parent remounts us when the link address changes) so typing never loses the cursor.
    if (ref.current) ref.current.innerHTML = linkedHtml(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => ref.current && onChange(toMarkdown(ref.current));
  const selectionInside = () => {
    const sel = window.getSelection();
    return sel && !sel.isCollapsed && ref.current?.contains(sel.anchorNode) ? sel : null;
  };
  const link = () => {
    if (!selectionInside() || !url) return;
    document.execCommand("createLink", false, url);
    emit();
  };
  const unlink = () => {
    if (!selectionInside()) return;
    document.execCommand("unlink");
    emit();
  };
  const btn = { padding: "6px 12px", border: "1px solid #c9c9c9", borderRadius: 8, background: "#f1f1f1", cursor: "pointer", fontSize: 13 } as const;
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{label}</div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        style={{
          minHeight: rows * 22,
          border: "1px solid #8a8a8a",
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 14,
          lineHeight: "22px",
          whiteSpace: "pre-wrap",
          background: "#fff",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={btn} onMouseDown={keep} onClick={link}>Link selected words to the article</button>
        <button type="button" style={btn} onMouseDown={keep} onClick={unlink}>Remove link</button>
        <span style={{ color: "#6a6a6a", fontSize: 12 }}>Select some words, then press the button.</span>
      </div>
    </div>
  );
}
