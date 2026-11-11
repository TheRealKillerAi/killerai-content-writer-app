// Strips anything that can run code from article HTML before it is shown or edited in the admin.
// Articles are written by AI from merchant/product text, so we never trust them to be script-free.
export function safeHtml(html: string): string {
  return (html || "")
    .replace(/<\s*(script|iframe|object|embed|style|link|meta|base|form)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, "")
    .replace(/<\s*(script|iframe|object|embed|style|link|meta|base|form)\b[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src|xlink:href|action|formaction)\s*=\s*("\s*(javascript|data|vbscript):[^"]*"|'\s*(javascript|data|vbscript):[^']*'|(javascript|data|vbscript):[^\s>]*)/gi, "");
}
