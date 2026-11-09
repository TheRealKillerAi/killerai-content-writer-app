type Item = { state: "writing" | "done" | "failed"; status: string | null; sentAs: "draft" | "live" | null; seo: number | null };

export function SeoBadge({ seo }: { seo: number | null }) {
  if (seo === null) return <span>—</span>;
  return <s-badge tone={seo >= 80 ? "success" : seo >= 60 ? "warning" : "critical"}>{String(Math.round(seo))}</s-badge>;
}

export function StatusBadges({ a }: { a: Item }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {a.state === "writing" ? (
        <s-badge tone="info">Writing…</s-badge>
      ) : a.state === "failed" ? (
        <s-badge tone="critical">Failed</s-badge>
      ) : a.status === "READY FOR MERCHANT APPROVAL" ? (
        <s-badge tone="success">Ready</s-badge>
      ) : (
        <s-badge tone="warning">Needs review</s-badge>
      )}
      {a.sentAs ? <s-badge tone={a.sentAs === "live" ? "success" : "neutral"}>{a.sentAs === "live" ? "On blog" : "Blog draft"}</s-badge> : null}
    </div>
  );
}
