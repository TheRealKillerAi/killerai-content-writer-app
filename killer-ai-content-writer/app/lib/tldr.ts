// TL;DR box styling, shared by the settings preview, the article preview and the HTML sent to Shopify.
export type TldrStyle = {
  tldrEnabled: boolean;
  tldrLabel: string;
  tldrBg: string;
  tldrText: string;
  tldrCorners: "rounded" | "square";
  tldrFontSize: number; // px
  tldrFont: "theme" | "serif" | "sans" | "mono";
};

export const TLDR_DEFAULTS: TldrStyle = {
  tldrEnabled: true,
  tldrLabel: "TL;DR",
  tldrBg: "#f4f4f5",
  tldrText: "#1a1a1a",
  tldrCorners: "rounded",
  tldrFontSize: 16,
  tldrFont: "theme",
};

const FONTS = {
  theme: "",
  serif: "font-family:Georgia,'Times New Roman',serif;",
  sans: "font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;",
  mono: 'font-family:ui-monospace,Menlo,Consolas,monospace;',
} as const;

export const clampPx = (n: number) => (Number.isFinite(n) ? Math.min(48, Math.max(10, Math.round(n))) : TLDR_DEFAULTS.tldrFontSize);

export const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function tldrBoxStyle(s: TldrStyle): string {
  const bg = isHex(s.tldrBg) ? s.tldrBg : TLDR_DEFAULTS.tldrBg;
  const fg = isHex(s.tldrText) ? s.tldrText : TLDR_DEFAULTS.tldrText;
  return (
    `background-color:${bg};color:${fg};border-radius:${s.tldrCorners === "square" ? "0" : "12px"};` +
    `padding:18px 22px;margin:0 0 24px;font-size:${clampPx(s.tldrFontSize)}px;line-height:1.55;${FONTS[s.tldrFont] ?? ""}`
  );
}

export function tldrHtml(text: string, s: TldrStyle): string {
  const label = (s.tldrLabel || "TL;DR").trim();
  return `<div style="${tldrBoxStyle(s)}"><p style="margin:0;color:inherit"><strong>${esc(label)}:</strong> ${esc(text)}</p></div>`;
}

function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  if (!isHex(a) || !isHex(b)) return 21;
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
