import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { existingArticleTitles, getProduct } from "../lib/products.server";
import { deleteFact, clearChosen, loadAngles, loadChosen, loadFacts, saveAngles, saveChosen, saveFacts } from "../lib/facts.server";
import { findAngles } from "../lib/pipeline/angles.server";
import { askQuestions } from "../lib/pipeline/questions.server";
import { loadEffectiveSettings } from "../lib/settings.server";
import { listArticles, startArticle } from "../lib/articles.server";
import { LlmError } from "../lib/pipeline/llm.server";
import type { Angle, MerchantFacts, Question } from "../lib/pipeline/types";

const gidFor = (id: string) => `gid://shopify/Product/${id}`;

type ActionResult = {
  intent: "angles" | "questions" | "save" | "delete" | "write" | "clear";
  error: string | null;
  angles?: Angle[];
  angle?: Angle;
  factBudget?: string;
  questions?: Question[];
  saved?: boolean;
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const product = await getProduct(admin, gidFor(params.id!));
  if (!product) throw new Response("Product not found", { status: 404 });
  const facts = await loadFacts(session.shop, params.id!);
  const savedAngles = await loadAngles(session.shop, params.id!);
  const chosen = await loadChosen(session.shop, params.id!);
  const articles = await listArticles(session.shop, params.id!);
  return { product, facts, savedAngles, chosen, articles };
};

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent")) as ActionResult["intent"];
  const productId = params.id!;
  try {
    if (intent === "save") {
      const items = JSON.parse(String(form.get("items") ?? "[]")) as { question: string; answer: string; unknown: boolean }[];
      await saveFacts(session.shop, productId, items);
      return { intent, error: null, saved: true };
    }
    if (intent === "clear") {
      await clearChosen(session.shop, productId);
      return { intent, error: null };
    }
    if (intent === "delete") {
      await deleteFact(session.shop, productId, String(form.get("question")));
      return { intent, error: null };
    }
    const product = await getProduct(admin, gidFor(productId));
    if (!product) return { intent, error: "Product not found." };
    const facts = await loadFacts(session.shop, productId);
    if (intent === "write") {
      const angle = JSON.parse(String(form.get("angle"))) as Angle;
      const id = await startArticle(session.shop, productId, product.facts, angle, facts, await loadEffectiveSettings(admin, session.shop));
      throw redirect(`/app/article/${id}`);
    }
    if (intent === "angles") {
      const kept = await loadAngles(session.shop, productId);
      const existing = [...(await existingArticleTitles(admin)), ...kept.map((a) => a.working_title)];
      const { angles: fresh } = await findAngles(product.facts, existing, facts.known, await loadEffectiveSettings(admin, session.shop));
      // Keep what's already there and add genuinely new angles (no duplicates by title or search term).
      const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const seen = new Set(kept.flatMap((a) => [key(a.working_title), key(a.target_query)]));
      const added = fresh.filter((a) => {
        const k1 = key(a.working_title);
        const k2 = key(a.target_query);
        if (seen.has(k1) || seen.has(k2)) return false;
        seen.add(k1);
        seen.add(k2);
        return true;
      });
      const angles = [...kept, ...added].slice(0, 30);
      await saveAngles(session.shop, productId, angles);
      return { intent, error: null, angles };
    }
    const angle = JSON.parse(String(form.get("angle"))) as Angle;
    await saveChosen(session.shop, productId, angle);
    const { factBudget, questions } = await askQuestions(product.facts, angle, facts);
    return { intent, error: null, angle, factBudget, questions };
  } catch (e) {
    if (e instanceof Response) throw e;
    const message = e instanceof LlmError ? e.message : "Something went wrong. Please try again.";
    return { intent, error: message };
  }
};

function answerLabel(n: number) {
  return n >= 3 ? "Fully answerable from your product data" : n === 2 ? "Mostly answerable" : "A few extra details would help";
}

function FactsList({
  facts,
  onRemove,
  onEdit,
  saving,
}: {
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
    <s-section heading="Facts you've told us">
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
            <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-badge tone="warning">Don't know</s-badge>
                <s-text>{q} — we won't cover this</s-text>
              </s-stack>
              <s-button onClick={() => onRemove(q)}>Ask again</s-button>
            </s-grid>
          </s-box>
        ))}
      </s-stack>
    </s-section>
  );
}

function QuestionForm({
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
  questions: Question[];
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
        Your answers become trusted facts for the article, so only say what you are sure of (check your packaging or
        supplier sheet). Tick "I don't know" and we'll leave that topic out rather than guess.
        {factBudget === "low" ? " The product page alone has few facts for this angle, so these answers matter." : ""}
      </s-paragraph>
      {questions.map((q, i) => (
        <s-box key={q.q} padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small">
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

export default function ProductPage() {
  const { product, facts, savedAngles, chosen, articles } = useLoaderData<typeof loader>();
  const anglesF = useFetcher<ActionResult>();
  const questionsF = useFetcher<ActionResult>();
  const saveF = useFetcher<ActionResult>();
  const writeF = useFetcher<ActionResult>();
  const clearF = useFetcher<ActionResult>();
  const f = product.facts;
  const angles = anglesF.data?.angles ?? savedAngles;
  const anglesBusy = anglesF.state !== "idle";
  const questionsBusy = questionsF.state !== "idle";
  const anglesRef = useRef<HTMLDivElement>(null);
  const questionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (anglesF.data) anglesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [anglesF.data]);
  useEffect(() => {
    if (questionsF.data) questionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [questionsF.data]);

  const q = questionsF.data;
  const step = chosen ? 2 : 1;
  const [selected, setSelected] = useState<number | null>(null);

  // After answers are saved, automatically re-check whether anything else is missing for this angle.
  useEffect(() => {
    if (saveF.data?.saved && q?.angle) {
      questionsF.submit({ intent: "questions", angle: JSON.stringify(q.angle) }, { method: "POST" });
    }
  }, [saveF.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <s-page heading={f.title}>
      <s-link slot="breadcrumb-actions" href="/app/products">Products</s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        {...(anglesBusy ? { loading: true } : {})}
        onClick={() => anglesF.submit({ intent: "angles" }, { method: "POST" })}
      >
        {angles.length ? "Refresh article angles" : "Find article angles"}
      </s-button>

      <s-banner tone="info" heading={step === 1 ? "Step 1 of 3: choose an angle" : "Step 2 of 3: check your facts"}>
        {step === 1
          ? angles.length
            ? "Select the angle you want to write about, then press Continue."
            : 'Click "Find article angles" (top right). We suggest what shoppers search for, based on your product facts.'
          : "Add any extra details below if you'd like (or skip this), then press Continue to write the article."}
      </s-banner>

      {step === 2 && chosen ? (
        <s-section heading="Your chosen angle">
          <s-stack direction="block" gap="small">
            <s-text><strong>{chosen.working_title}</strong></s-text>
            <s-stack direction="inline">
              <s-button
                {...(questionsBusy ? { loading: true } : {})}
                onClick={() => questionsF.submit({ intent: "questions", angle: JSON.stringify(chosen) }, { method: "POST" })}
              >
                Check for extra details
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}

      {articles.length ? (
        <s-section heading="Articles you've written for this product">
          <s-stack direction="block" gap="small">
            {articles.map((a) => (
              <s-stack key={a.id} direction="inline" gap="small" alignItems="center">
                <s-link href={`/app/article/${a.id}`}>{a.title}</s-link>
                {a.state === "writing" ? (
                  <s-badge tone="info">Writing…</s-badge>
                ) : a.state === "failed" ? (
                  <s-badge tone="critical">Failed</s-badge>
                ) : a.status === "READY FOR MERCHANT APPROVAL" ? (
                  <s-badge tone="success">Ready</s-badge>
                ) : (
                  <s-badge tone="warning">Needs review</s-badge>
                )}
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading="What we know about this product">
        <s-stack direction="block" gap="small">
          <s-paragraph>
            The article can only state facts found here (plus anything you add below). If something is missing from
            your product page, it will not be guessed.
          </s-paragraph>
          <s-text>Type: {f.productType || "not set"} · Vendor: {f.vendor || "not set"}</s-text>
          {f.options.length ? (
            <s-text>Options: {f.options.map((o) => `${o.name} (${o.values.join(", ")})`).join(" · ")}</s-text>
          ) : null}
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <div dangerouslySetInnerHTML={{ __html: f.description_html || "<em>No description yet.</em>" }} />
          </s-box>
        </s-stack>
      </s-section>

      <FactsList
        facts={facts}
        onRemove={(question) => saveF.submit({ intent: "delete", question }, { method: "POST" })}
        onEdit={(question, answer) =>
          saveF.submit(
            { intent: "save", items: JSON.stringify([{ question, answer, unknown: false }]) },
            { method: "POST" },
          )
        }
        saving={saveF.state !== "idle"}
      />

      {anglesBusy ? (
        <s-banner tone="info" heading="Finding article angles">
          Reading your product facts and thinking about what shoppers search for. This takes about 10 to 20 seconds.
        </s-banner>
      ) : null}

      <div ref={anglesRef} style={{ scrollMarginTop: 90 }} />
      {anglesF.data?.error ? (
        <s-banner tone="critical" heading="We couldn't find angles">{anglesF.data.error}</s-banner>
      ) : null}

      {step === 1 && angles.length ? (
        <s-section heading="Suggested article angles">
          <s-paragraph>
            These are AI suggestions based on your product facts. They are not measured search volumes.
          </s-paragraph>
          <s-stack direction="block" gap="base">
            {angles.map((a, i) => (
              <s-box key={i} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-heading>{a.working_title}</s-heading>
                  <s-text>Target search: {a.target_query}</s-text>
                  <s-paragraph>{a.why_it_fits}</s-paragraph>
                  <s-stack direction="inline" gap="small">
                    <s-badge tone={a.answerable_from_data >= 2 ? "success" : "warning"}>
                      {answerLabel(a.answerable_from_data)}
                    </s-badge>
                    {a.risk === "high" ? <s-badge tone="critical">Health or safety topic: extra review</s-badge> : null}
                    {a.overlaps_existing ? <s-badge tone="warning">Similar to an existing article</s-badge> : null}
                  </s-stack>
                  {a.needs_info?.length ? <s-text>Would be better with: {a.needs_info.join("; ")}</s-text> : null}
                  <s-stack direction="inline">
                    <s-button
                      variant={selected === i ? "primary" : "secondary"}
                      onClick={() => setSelected(i)}
                    >
                      {selected === i ? "Selected ✓" : "Select this angle"}
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      ) : null}

      {questionsBusy ? (
        <s-banner tone="info" heading="Checking what we still need from you">
          This takes a few seconds.
        </s-banner>
      ) : null}

      <div ref={questionsRef} style={{ scrollMarginTop: 90 }} />
      {q?.error ? <s-banner tone="critical" heading="We couldn't prepare the questions">{q.error}</s-banner> : null}
      {step === 2 && q?.angle && !q.error ? (
        <s-section heading={`Before we write: ${q.angle.working_title}`}>
          {saveF.data?.saved ? (
            <s-banner tone="success" heading="Saved">
              Your answers are saved as facts for this product. We've checked again for any other helpful details.
            </s-banner>
          ) : null}
          <QuestionForm
            key={q.angle.working_title + (q.questions?.length ?? 0)}
            angle={q.angle}
            questions={q.questions ?? []}
            factBudget={q.factBudget ?? "low"}
            saving={saveF.state !== "idle"}
            writing={writeF.state !== "idle"}
            onWrite={() => writeF.submit({ intent: "write", angle: JSON.stringify(q.angle) }, { method: "POST" })}
            onSave={(items) => saveF.submit({ intent: "save", items: JSON.stringify(items) }, { method: "POST" })}
          />
        </s-section>
      ) : null}

      <s-section>
        <s-stack direction="inline" justifyContent="space-between" alignItems="center">
          {step === 1 ? (
            <s-button href="/app/products">← Back to products</s-button>
          ) : (
            <s-button
              {...(clearF.state !== "idle" ? { loading: true } : {})}
              onClick={() => clearF.submit({ intent: "clear" }, { method: "POST" })}
            >
              ← Back to angles
            </s-button>
          )}
          {step === 1 ? (
            <s-button
              variant="primary"
              {...(selected === null || !angles.length ? { disabled: true } : {})}
              {...(questionsBusy ? { loading: true } : {})}
              onClick={() =>
                selected !== null &&
                questionsF.submit({ intent: "questions", angle: JSON.stringify(angles[selected]) }, { method: "POST" })
              }
            >
              Continue →
            </s-button>
          ) : (
            <s-button
              variant="primary"
              {...(writeF.state !== "idle" ? { loading: true } : {})}
              onClick={() => chosen && writeF.submit({ intent: "write", angle: JSON.stringify(chosen) }, { method: "POST" })}
            >
              Continue: write the article →
            </s-button>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
