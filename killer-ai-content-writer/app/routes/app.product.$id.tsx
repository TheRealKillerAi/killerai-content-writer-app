import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { UsageMeter } from "../components/UsageMeter";
import { monthlyUsage } from "../lib/usage.server";
import { authenticate } from "../shopify.server";
import { existingArticleTitles, getProduct } from "../lib/products.server";
import { deleteFact, clearChosen, loadAngles, loadChosen, loadFacts, saveAngles, saveChosen, saveFacts } from "../lib/facts.server";
import { findAngles } from "../lib/pipeline/angles.server";
import { askQuestions } from "../lib/pipeline/questions.server";
import { loadEffectiveSettings } from "../lib/settings.server";
import { coveredTopics, listArticles, startArticle } from "../lib/articles.server";
import { findCovered } from "../lib/keywords";
import { LlmError } from "../lib/pipeline/llm.server";
import type { Angle, Question } from "../lib/pipeline/types";
import { FactsList, QuestionForm } from "../components/FactsUi";

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
  const covered = await coveredTopics(session.shop);
  return { product, facts, savedAngles, chosen, articles, covered, usage: await monthlyUsage(session.shop) };
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
      const id = await startArticle(session.shop, productId, product.facts, angle, facts, await loadEffectiveSettings(admin, session.shop), undefined, admin);
      throw redirect(`/app/article/${id}`);
    }
    if (intent === "angles") {
      const kept = await loadAngles(session.shop, productId);
      const covered = await coveredTopics(session.shop);
      const existing = [
        ...(await existingArticleTitles(admin)),
        ...kept.map((a) => a.working_title),
        ...covered.flatMap((c) => [c.title, c.keyword].filter((x): x is string => !!x)),
      ];
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
      await clearChosen(session.shop, productId); // new angles are shown on step 1
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
  return n >= 3 ? "Your product data covers this" : n === 2 ? "Mostly answerable" : "A few extra details would help";
}

export default function ProductPage() {
  const { product, facts, savedAngles, chosen, articles, covered, usage } = useLoaderData<typeof loader>();
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

  const q = questionsF.data;
  // Coming back from an article ("add details"): open the questions for the chosen topic straight away.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("refine") && chosen && !questionsF.data && questionsF.state === "idle") {
      questionsF.submit({ intent: "questions", angle: JSON.stringify(chosen) }, { method: "POST" });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The facts step only shows while a topic is open in this visit. Coming back later always starts at the saved topics.
  const [inFacts, setInFacts] = useState(false);
  useEffect(() => {
    if (questionsF.data?.angle) setInFacts(true);
  }, [questionsF.data]);
  const active = inFacts ? q?.angle ?? null : null;
  const step = active ? 2 : 1;
  // Scroll to the start of "Before we write" once it is on the page (not before, or the page is too short to reach it).
  const factsTitle = active?.working_title ?? "";
  useEffect(() => {
    if (!factsTitle) return;
    const t = setTimeout(() => questionsRef.current?.scrollIntoView({ behavior: "auto", block: "start" }), 80);
    return () => clearTimeout(t);
  }, [factsTitle]);
  const [selected, setSelected] = useState<number | null>(null);
  const [own, setOwn] = useState("");
  const useOwn = () => {
    const t = own.trim();
    if (!t) return;
    const angle: Angle = {
      working_title: t,
      target_query: t.toLowerCase().replace(/[?.!]+$/, ""),
      intent: "informational",
      why_it_fits: "A topic you chose yourself.",
      answerable_from_data: 2,
      needs_outside_evidence: false,
      needs_info: [],
      risk: "normal",
      overlaps_existing: false,
    };
    questionsF.submit({ intent: "questions", angle: JSON.stringify(angle) }, { method: "POST" });
  };

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
        {angles.length ? "Generate more topics" : "Generate article topics"}
      </s-button>

      <s-section>
        <UsageMeter usage={usage} />
      </s-section>

      <s-banner tone="info" heading={step === 1 ? "Step 1 of 3: choose a topic" : "Step 2 of 3: check your facts"}>
        {step === 1
          ? angles.length
            ? "Select the topic you want to write about, then press Continue. Next we'll check which details would make the article stronger, so you may be asked a few short questions (you can skip them)."
            : 'Click "Generate article topics" (top right). We suggest what shoppers search for, based on your product facts.'
          : "Add any extra details below if you'd like (or skip this), then press Continue to write the article."}
      </s-banner>

      {step === 2 && active ? (
        <s-section heading="Your chosen topic">
          <s-stack direction="block" gap="small">
            <s-text><strong>{active.working_title}</strong></s-text>
            <s-stack direction="inline">
              <s-button
                {...(questionsBusy ? { loading: true } : {})}
                onClick={() => questionsF.submit({ intent: "questions", angle: JSON.stringify(active) }, { method: "POST" })}
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
          {f.variant_weights?.length ? (
            <s-text>Recorded weight: {f.variant_weights.map((w) => (w.variant ? `${w.variant} ${w.weight}` : w.weight)).join(" · ")}</s-text>
          ) : null}
          {f.details?.length ? <s-text>Product fields: {f.details.map((d) => `${d.name}: ${d.value}`).join(" · ")}</s-text> : null}
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
        <s-banner tone="info" heading="Finding article topics">
          Reading your product facts and thinking about what shoppers search for. This takes about 10 to 20 seconds.
        </s-banner>
      ) : null}

      <div ref={anglesRef} style={{ scrollMarginTop: 90 }} />
      {anglesF.data?.error ? (
        <s-banner tone="critical" heading="We couldn't find topics">{anglesF.data.error}</s-banner>
      ) : null}

      {step === 1 && angles.length ? (
        <s-section heading="Suggested article topics">
          <s-paragraph>
            These are AI suggestions based on your product facts. They are not measured search volumes. For search volumes, upgrade your plan <s-link href="/app/plans">here</s-link>.
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
                    {(() => {
                      const c = findCovered(a, covered);
                      if (!c) return null;
                      return (
                        <s-badge tone="warning">
                          {c.sentAs ? `Already on your blog${c.title ? `: ${c.title}` : ""}` : "You've already written this topic"}
                        </s-badge>
                      );
                    })()}
                  </s-stack>
                  {a.needs_info?.length ? <s-text>Would be better with: {a.needs_info.join("; ")}</s-text> : null}
                  <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                    <s-button
                      variant={selected === i ? "primary" : "secondary"}
                      onClick={() => setSelected(i)}
                    >
                      {selected === i ? "Selected ✓" : "Select this topic"}
                    </s-button>
                    {selected === i ? (
                      <s-button
                        variant="primary"
                        {...(questionsBusy ? { loading: true } : {})}
                        onClick={() => questionsF.submit({ intent: "questions", angle: JSON.stringify(a) }, { method: "POST" })}
                      >
                        Continue →
                      </s-button>
                    ) : null}
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

      {step === 1 ? (
        <s-section heading="Or write about your own topic">
          <s-stack direction="block" gap="small">
            <s-text-field
              label="Your topic"
              details="A title or the question you'd like answered, for example: How do I look after my cup?"
              value={own}
              onInput={(e) => setOwn((e.currentTarget as unknown as { value: string }).value)}
            />
            <s-stack direction="inline">
              <s-button
                {...(!own.trim() ? { disabled: true } : {})}
                {...(questionsBusy ? { loading: true } : {})}
                onClick={useOwn}
              >
                Use my topic →
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}

      <s-section>
        <s-stack direction="inline" justifyContent="space-between" alignItems="center">
          {step === 1 ? (
            <s-button href="/app/products">← Back to products</s-button>
          ) : (
            <s-button
              {...(clearF.state !== "idle" ? { loading: true } : {})}
              onClick={() => {
                setInFacts(false);
                clearF.submit({ intent: "clear" }, { method: "POST" });
              }}
            >
              ← Back to topics
            </s-button>
          )}
          {step === 1 ? (
            <s-stack direction="inline" gap="small">
              <s-button
                variant={angles.length ? "secondary" : "primary"}
                {...(anglesBusy ? { loading: true } : {})}
                onClick={() => anglesF.submit({ intent: "angles" }, { method: "POST" })}
              >
                {angles.length ? "Generate more topics" : "Generate article topics"}
              </s-button>
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
            </s-stack>
          ) : (
            <s-button
              variant="primary"
              {...(writeF.state !== "idle" ? { loading: true } : {})}
              onClick={() => active && writeF.submit({ intent: "write", angle: JSON.stringify(active) }, { method: "POST" })}
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
