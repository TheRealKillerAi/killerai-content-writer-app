import type { Usage } from "../lib/usage.server";

/** A simple "articles used this month" bar. */
export function UsageMeter({ usage }: { usage: Usage }) {
  const pct = Math.min(100, Math.round((usage.used / Math.max(1, usage.limit)) * 100));
  const near = pct >= 80;
  const resets = new Date(usage.resetsOn).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, gap: 12, flexWrap: "wrap" }}>
        <strong>{usage.used} of {usage.limit} articles used this month</strong>
        <span style={{ opacity: 0.7 }}>Resets {resets}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "rgba(0,0,0,0.1)", overflow: "hidden" }} role="progressbar" aria-valuenow={usage.used} aria-valuemin={0} aria-valuemax={usage.limit}>
        <div style={{ width: `${pct}%`, height: "100%", background: near ? "#b98900" : "#303030" }} />
      </div>
    </div>
  );
}
