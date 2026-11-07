import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { existingArticleTitles, getProduct } from "../lib/products.server";
import { deleteFact, loadFacts, saveFacts } from "../lib/facts.server";
import { findAngles } from "../lib/pipeline/angles.server";
import { askQuestions } from "../lib/pipeline/questions.server";
import { LlmError } from "../lib/pipeline/llm.server";
import type { Angle, MerchantFacts, Question } from "../lib/pipeline/types";

const gidFor = (id: string) => `gid://shopify/Product/${id}`;

type ActionResult = {
  intent: "angles" | "questions" | "save" | "delete";
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
  return { product, facts };
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
    if (intent === "delete") {
      await deleteFact(session.shop, productId, String(form.get("question")));
      return { intent, error: null };
    }
    const product = await getProduct(admin, gidFor(productId));
    if (!product) return { intent, error: "Product not found." };
    const facts = await loadFacts(session.shop, productId);
    if (intent === "angles") {
      const existing = await existingArticleTitles(admin);
      const { angles } = await findAngles(product.facts, existing, facts.known);
      return { intent, error: null, angles };
    }
    const angle = JSON.parse(String(form.get("angle"))) as Angle;
    const { factBudget, questions } = await askQuestions(product.facts, angle, facts);
    return { intent, error: null, angle, factBudget, questions };
  } catch (e) {
    const message = e instanceof LlmError ? e.message : "Something went wrong. Please try again.";
    return { intent, error: message };
  }
};

function answerLabel(n: number) {
  return n >= 3 ? "Fully answerable from your product data" : n === 2 ? "Mostly answerable" : "Needs more facts from you";
}

function FactsList({ facts, onRemove }: { facts: MerchantFacts; onRemove: (q: string) => void }) {
  const known = Object.entries(facts.known);
  if (!known.length && !facts.unknown.length) return null;
  return (
    <s-section heading="Facts you've told us">
      <s-stack direction="block" gap="small">
        {known.map(([q, a]) => (
          <s-stack key={q} direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-text>{q} — <strong>{a}</strong></s-text>
            <s-button variant="tertiary" onClick={() => onRemove(q)}>Remove</s-button>
          </s-stack>
        ))}
        {facts.unknown.map((q) => (
          <s-stack key={q} direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-text>{q} — <em>you don't know (we won't cover this)</em></s-text>
            <s-button variant="tertiary" onClick={() => onRemove(q)}>Ask again</s-button>
          </s-stack>
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
}: {
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
        There is plenty of product information for "{angle.working_title}". The next step (writing the article) comes
        next in the app.
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
              onInput={(e) =>
                setAnswers((a) => ({ ...a, [i]: (e.currentTarget as unknown as { value: string }).value }))
              }
            />
            <s-checkbox
              label="I don't know"
              checked={!!unknown[i]}
              onChange={(e) =>
                setUnknown((u) => ({ ...u, [i]: (e.currentTarget as unknown as { checked: boolean }).checked }))
              }
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
    </s-stack>
  );
}

export default function ProductPage() {
  const { product, facts } = useLoaderData<typeof loader>();
  const anglesF = useFetcher<ActionResult>();
  const questionsF = useFetcher<ActionResult>();
  const saveF = useFetcher<ActionResult>();
  const f = product.facts;
  const angles = anglesF.data?.angles ?? [];
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

  return (
    <s-page heading={f.title}>
      <s-link slot="breadcrumb-actions" href="/app">Products</s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        {...(anglesBusy ? { loading: true } : {})}
        onClick={() => anglesF.submit({ intent: "angles" }, { method: "POST" })}
      >
        Find article angles
      </s-button>

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
      />

      {anglesBusy ? (
        <s-banner tone="info" heading="Finding article angles">
          Reading your product facts and thinking about what shoppers search for. This takes about 10 to 20 seconds.
        </s-banner>
      ) : null}

      <div ref={anglesRef} />
      {anglesF.data?.error ? (
        <s-banner tone="critical" heading="We couldn't find angles">{anglesF.data.error}</s-banner>
      ) : null}

      {angles.length ? (
        <s-section heading="Suggested article angles">
          <s-paragraph>
            These are AI suggestions based on your product facts. They are not measured search volumes. Choose one to
            continue.
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
                      variant="primary"
                      {...(questionsBusy ? { disabled: true } : {})}
                      onClick={() =>
                        questionsF.submit({ intent: "questions", angle: JSON.stringify(a) }, { method: "POST" })
                      }
                    >
                      Choose this angle
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

      <div ref={questionsRef} />
      {q?.error ? <s-banner tone="critical" heading="We couldn't prepare the questions">{q.error}</s-banner> : null}
      {q?.angle && !q.error ? (
        <s-section heading={`Before we write: ${q.angle.working_title}`}>
          {saveF.data?.saved ? (
            <s-banner tone="success" heading="Saved">
              Your answers are saved as facts for this product. Choose the angle again to see if anything else is
              needed.
            </s-banner>
          ) : null}
          <QuestionForm
            key={q.angle.working_title + (q.questions?.length ?? 0)}
            angle={q.angle}
            questions={q.questions ?? []}
            factBudget={q.factBudget ?? "low"}
            saving={saveF.state !== "idle"}
            onSave={(items) => saveF.submit({ intent: "save", items: JSON.stringify(items) }, { method: "POST" })}
          />
        </s-section>
      ) : null}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
