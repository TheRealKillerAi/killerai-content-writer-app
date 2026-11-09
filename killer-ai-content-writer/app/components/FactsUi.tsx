import { useState } from "react";
import type { Angle, MerchantFacts, Question } from "../lib/pipeline/types";

export function FactsList({
  facts,
  onRemove,
  onEdit,
  saving,
  heading = "Facts you've told us",
}: {
  heading?: string;
  facts: MerchantFacts;
  onRemove: (q: string) => void;
  onEdit: (q: string, answer: string) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const known = Object.entries(facts.known);
  if (!known.length && !facts.unknown.length) return null;

  return (
    <s-section heading={heading}>
      <s-stack direction="block" gap="base">
        {known.map(([q, a]) => (
          <s-box key={q} padding="base" borderWidth="base" borderRadius="base">
            {editing === q ? (
              <s-stack direction="block" gap="small">
                <s-text><strong>{q}</strong></s-text>
                <s-text-field
                  label="Answer"
                  labelAccessibilityVisibility="exclusive"
                  value={draft}
                  onInput={(e) => {
                    const value = (e.currentTarget as unknown as { value: string }).value;
                    setDraft(value);
                  }}
                />
                <s-stack direction="inline" gap="small">
                  <s-button
                    variant="primary"
                    {...(saving ? { loading: true } : {})}
                    onClick={() => {
                      if (draft.trim()) onEdit(q, draft);
                      setEditing(null);
                    }}
                  >
                    Save
                  </s-button>
                  <s-button onClick={() => setEditing(null)}>Cancel</s-button>
                </s-stack>
              </s-stack>
            ) : (
              <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                <s-text>{q} — <strong>{a}</strong></s-text>
                <s-stack direction="inline" gap="small">
                  <s-button
                    onClick={() => {
                      setDraft(a);
                      setEditing(q);
                    }}
                  >
                    Edit
                  </s-button>
                  <s-button tone="critical" onClick={() => onRemove(q)}>Remove</s-button>
                </s-stack>
              </s-grid>
            )}
          </s-box>
        ))}
        {facts.unknown.map((q) => (
          <s-box key={q} padding="base" borderWidth="base" borderRadius="base">
            {editing === q ? (
              <s-stack direction="block" gap="small">
                <s-text><strong>{q}</strong></s-text>
                <s-text-field
                  label="Answer"
                  labelAccessibilityVisibility="exclusive"
                  value={draft}
                  onInput={(e) => setDraft((e.currentTarget as unknown as { value: string }).value)}
                />
                <s-stack direction="inline" gap="small">
                  <s-button
                    variant="primary"
                    {...(saving ? { loading: true } : {})}
                    onClick={() => {
                      if (draft.trim()) onEdit(q, draft);
                      setEditing(null);
                    }}
                  >
                    Save
                  </s-button>
                  <s-button onClick={() => setEditing(null)}>Cancel</s-button>
                </s-stack>
              </s-stack>
            ) : (
              <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-badge tone="warning">Don't know</s-badge>
                  <s-text>{q} — we won't cover this</s-text>
                </s-stack>
                <s-button
                  onClick={() => {
                    setDraft("");
                    setEditing(q);
                  }}
                >
                  Answer this
                </s-button>
              </s-grid>
            )}
          </s-box>
        ))}
      </s-stack>
    </s-section>
  );
}

export function QuestionForm({
  angle,
  questions,
  factBudget,
  saving,
  onSave,
  onWrite,
  writing,
}: {
  onWrite: () => void;
  writing: boolean;
  angle: Angle;
  questions: (Question & { product?: string })[];
  factBudget: string;
  saving: boolean;
  onSave: (items: { question: string; answer: string; unknown: boolean }[]) => void;
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [unknown, setUnknown] = useState<Record<number, boolean>>({});

  if (!questions.length) {
    return (
      <s-banner tone="success" heading="You've given us enough to work with">
        There is plenty of product information for "{angle.working_title}".
        <s-stack direction="inline">
          <s-button variant="primary" {...(writing ? { loading: true } : {})} onClick={onWrite}>
            Write this article
          </s-button>
        </s-stack>
      </s-banner>
    );
  }
  return (
    <s-stack direction="block" gap="base">
      <s-paragraph>
        This angle can be written from your product data, but a fuller article (500+ words works best for search)
        needs a little more detail. Your answers become trusted facts, so only say what you are sure of (check your
        packaging or supplier sheet). Tick "I don't know" and we'll leave that topic out rather than guess.
        {factBudget === "low" ? " The product page alone has few facts for this topic, so these answers matter." : ""}
      </s-paragraph>
      {questions.map((q, i) => (
        <s-box key={`${q.product ?? ""}|${q.q}`} padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            {q.product ? <s-badge>{q.product}</s-badge> : null}
            <s-text><strong>{q.q}</strong></s-text>
            <s-text color="subdued">{q.why}</s-text>
            <s-text-field
              label={q.q}
              labelAccessibilityVisibility="exclusive"
              disabled={!!unknown[i]}
              value={answers[i] ?? ""}
              onInput={(e) => {
                const value = (e.currentTarget as unknown as { value: string }).value;
                setAnswers((a) => ({ ...a, [i]: value }));
              }}
            />
            <s-checkbox
              label="I don't know"
              checked={!!unknown[i]}
              onChange={(e) => {
                const checked = (e.currentTarget as unknown as { checked: boolean }).checked;
                setUnknown((u) => ({ ...u, [i]: checked }));
              }}
            />
          </s-stack>
        </s-box>
      ))}
      <s-button
        variant="primary"
        {...(saving ? { loading: true } : {})}
        onClick={() =>
          onSave(questions.map((q, i) => ({ question: q.q, answer: answers[i] ?? "", unknown: !!unknown[i] })))
        }
      >
        Save answers
      </s-button>
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-button {...(writing ? { loading: true } : {})} onClick={onWrite}>
          Skip and write with what we have
        </s-button>
        <s-text color="subdued">The article will be shorter and will leave out anything we have no facts for.</s-text>
      </s-stack>
    </s-stack>
  );
}

