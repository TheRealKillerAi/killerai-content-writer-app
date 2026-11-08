import { useState } from "react";
import { useFetcher } from "react-router";

const btn = { padding: "6px 14px", border: "1px solid #c9c9c9", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 14 } as const;

/** "Was this helpful?" thumbs. A thumbs-down offers an optional note. Saved through the feedback route. */
export function Thumbs({ context, question = "Was this helpful?" }: { context: string; question?: string }) {
  const f = useFetcher();
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);

  const send = (r: 1 | -1, message = "") => {
    f.submit({ intent: "thumb", rating: String(r), context, message }, { method: "POST", action: "/app/feedback" });
    setDone(true);
  };

  if (done) {
    return <s-text color="subdued">Thanks, that helps us improve.</s-text>;
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 14 }}>{question}</span>
        <button type="button" style={btn} aria-label="Yes" onClick={() => send(1)}>👍</button>
        <button type="button" style={btn} aria-label="No" onClick={() => setRating(-1)}>👎</button>
      </div>
      {rating === -1 ? (
        <div style={{ display: "grid", gap: 8 }}>
          <s-text-area
            label="What could be better? (optional)"
            rows={3}
            value={note}
            onInput={(e) => setNote((e.currentTarget as unknown as { value: string }).value)}
          />
          <div>
            <s-button variant="primary" onClick={() => send(-1, note)}>Send</s-button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
