import { MODE_LABEL, RULES, type RuleId, type RuleMode } from "../lib/refreshRules";

/** "How AI Refresh decides": every rule, what it does and how it is set right now. Nothing is hidden. */
export function RulesPanel({ rules }: { rules: Record<RuleId, RuleMode> }) {
  return (
    <details>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>How AI Refresh decides</summary>
      <div style={{ marginTop: 12 }}>
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            These are all the checks AI Refresh makes. Nothing is changed unless you accept it, a post's web address and published date never change, and you can
            switch any check to "point it out only" or off in Settings.
          </s-paragraph>
          {RULES.map((r) => (
            <div key={r.id}>
              <strong>{r.name}</strong> <s-badge tone={rules[r.id] === "off" ? "neutral" : "info"}>{MODE_LABEL[rules[r.id]]}</s-badge>
              <div>
                <s-text color="subdued">
                  Looks for: {r.looksFor} {r.action}
                </s-text>
              </div>
            </div>
          ))}
          <s-link href="/app/settings#refresh">Change these in Settings</s-link>
        </s-stack>
      </div>
    </details>
  );
}
