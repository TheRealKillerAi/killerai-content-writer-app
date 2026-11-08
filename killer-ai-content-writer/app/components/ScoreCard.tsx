import type { Check, Score } from "../lib/score";

const GREEN = "#0cce6b";
const ORANGE = "#ffa400";
const RED = "#ff4e42";
const colour = (pct: number) => (pct >= 90 ? GREEN : pct >= 50 ? ORANGE : RED);
const text = (pct: number) => (pct >= 90 ? "#018642" : pct >= 50 ? "#c33300" : "#c7221f");

function Gauge({ value }: { value: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <svg width="96" height="96" viewBox="0 0 100 100" role="img" aria-label={`SEO score ${value} out of 100`}>
      <circle cx="50" cy="50" r={r} fill={`${colour(value)}22`} stroke={`${colour(value)}33`} strokeWidth="8" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={colour(value)}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${(value / 100) * c} ${c}`}
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="58" textAnchor="middle" fontSize="28" fontFamily="ui-monospace, Menlo, Consolas, monospace" fill={text(value)}>
        {value}
      </text>
    </svg>
  );
}

function List({ checks }: { checks: Check[] }) {
  const sorted = [...checks].sort((a, b) => Number(a.pass) - Number(b.pass));
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 8 }}>
      {sorted.map((c) => (
        <li key={c.id} style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.4 }}>
          <span style={{ color: c.pass ? GREEN : RED, fontWeight: 700, width: 14 }}>{c.pass ? "✓" : "✕"}</span>
          <span>
            {c.label}
            {c.pass ? null : <span style={{ display: "block", color: "#6a6a6a" }}>{c.hint}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ScoreCard({ score, liveUrl }: { score: Score; liveUrl?: string | null }) {
  const aiPct = Math.round((score.ai.passed / score.ai.total) * 100);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ textAlign: "center" }}>
          <Gauge value={score.seo.score} />
          <div style={{ fontWeight: 600, marginTop: 4 }}>SEO</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 18px",
              borderRadius: 999,
              background: `${colour(aiPct)}22`,
              color: text(aiPct),
              fontSize: 22,
            }}
          >
            <span style={{ width: 14, height: 14, borderRadius: 7, background: colour(aiPct), display: "inline-block" }} />
            {score.ai.passed}/{score.ai.total}
          </div>
          <div style={{ fontWeight: 600, marginTop: 8 }}>AI readiness</div>
        </div>
      </div>
      <details>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          SEO checks ({score.seo.checks.filter((c) => c.pass).length}/{score.seo.checks.length} passed)
        </summary>
        <List checks={score.seo.checks} />
      </details>
      <details>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          AI readiness checks ({score.ai.passed}/{score.ai.total} passed)
        </summary>
        <List checks={score.ai.checks} />
      </details>
      <div style={{ color: "#6a6a6a", fontSize: 12, lineHeight: 1.4 }}>
        {liveUrl ? (
          <>
            Now that it's live, you can{" "}
            <a href={`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(liveUrl)}`} target="_blank" rel="noreferrer">
              test the page in PageSpeed Insights
            </a>
            .
          </>
        ) : null}
      </div>
    </div>
  );
}
