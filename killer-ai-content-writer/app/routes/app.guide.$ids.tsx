import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { existingArticleTitles, getProduct } from "../lib/products.server";
import { clearChosen, deleteFact, loadAngles, loadChosen, loadFacts, saveAngles, saveChosen, saveFacts } from "../lib/facts.server";
import { askGuideQuestions, findGuideAngles } from "../lib/pipeline/guide.server";
import { loadEffectiveSettings } from "../lib/settings.server";
import { listArticles, startArticle } from "../lib/articles.server";
import { LlmError } from "../lib/pipeline/llm.server";
import { guideKey, MAX_GUIDE_PRODUCTS } from "../lib/guide";
import type { Angle, MerchantFacts } from "../lib/pipeline/types";
import { FactsList, QuestionForm } from "../components/FactsUi";

type ActionResult = {
  intent: "angles" | "questions" | "save" | "delete" | "write" | "clear";
  error: string | null;
  angles?: Angle[];
  angle?: Angle;
  factBudget?: string;
  questions?: { q: string; why: string; product: string; productId: string }[];
  saved?: boolean;
};

async function loadProducts(admin: Parameters<typeof getProduct>[0], idsParam: string) {
  const ids = [...new Set(idsParam.split("-").filter((x) => /^\d+$/.test(x)))].slice(0, MAX_GUIDE_PRODUCTS);
  const found = await Promise.all(ids.map((id) => getProduct(admin, `gid://shopify/Product/${id}`)));
  return ids.flatMap((id, i) => (found[i] ? [{ ...found[i]!, id }] : []));
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const products = await loadProducts(admin, params.ids!);
  if (products.length < 2) throw redirect("/app/guide/new");
  const key = guideKey(products.map((p) => p.id));
  const facts = Object.fromEntries(await Promise.all(products.map(async (p) => [p.id, await loadFacts(session.shop, p.id)] as const)));
  return {
    products: products.map((p) => ({ id: p.id, title: p.facts.title, handle: p.facts.handle, imageUrl: p.imageUrl })),
    facts,
    savedAngles: await loadAngles(session.shop, key),
    chosen: await loadChosen(session.shop, key),
    articles: await listArticles(session.shop, key),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent")) as ActionResult["intent"];
  try {
    const products = await loadProducts(admin, params.ids!);
    if (products.length < 2) return { intent, error: "We couldn't find these products." };
    const key = guideKey(products.map((p) => p.id));
    const shop = session.shop;

    if (intent === "save") {
      const items = JSON.parse(String(form.get("items") ?? "[]")) as { productId: string; question: string; answer: string; unknown: boolean }[];
      const byProduct = new Map<string, typeof items>();
      for (const it of items) byProduct.set(it.productId, [...(byProduct.get(it.productId) ?? []), it]);
      for (const [productId, list] of byProduct) {
        if (products.some((p) => p.id === productId)) await saveFacts(shop, productId, list);
      }
      return { intent, error: null, saved: true };
    }
    if (intent === "clear") {
      await clearChosen(shop, key);
      return { intent, error: null };
    }
    if (intent === "delete") {
      const productId = String(form.get("productId"));
      if (products.some((p) => p.id === productId)) await deleteFact(shop, productId, String(form.get("question")));
      return { intent, error: null };
    }

    const factsById = Object.fromEntries(await Promise.all(products.map(async (p) => [p.id, await loadFacts(shop, p.id)] as const)));
    const factsByHandle: Record<string, MerchantFacts> = Object.fromEntries(products.map((p) => [p.facts.handle, factsById[p.id]]));
    const settings = await loadEffectiveSettings(admin, shop);

    if (intent === "write") {
      const angle = JSON.parse(String(form.get("angle"))) as Angle;
      const merchant: MerchantFacts = { known: {}, unknown: [] };
      for (const p of products) {
        const f = factsById[p.id];
        for (const [q, a] of Object.entries(f.known)) merchant.known[`${p.facts.title}: ${q}`] = a;
        for (const q of f.unknown) merchant.unknown.push(`${p.facts.title}: ${q}`);
      }
      const id = await startArticle(shop, key, products[0].facts, angle, merchant, settings, products.map((p) => p.facts));
      throw redirect(`/app/article/${id}`);
    }
    if (intent === "angles") {
      const kept = form.get("replace") ? [] : await loadAngles(shop, key);
      const existing = [...(await existingArticleTitles(admin)), ...kept.map((a) => a.working_title)];
      const fresh = await findGuideAngles(products.map((p) => p.facts), existing, factsByHandle, settings);
      const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const seen = new Set(kept.flatMap((a) => [norm(a.working_title), norm(a.target_query)]));
      const added = fresh.filter((a) => {
        const k1 = norm(a.working_title);
        const k2 = norm(a.target_query);
        if (seen.has(k1) || seen.has(k2)) return false;
        seen.add(k1);
        seen.add(k2);
        return true;
      });
      const angles = form.get("replace") ? fresh : [...kept, ...added].slice(0, 30);
      await saveAngles(shop, key, angles);
      return { intent, error: null, angles };
    }
    const angle = JSON.parse(String(form.get("angle"))) as Angle;
    await saveChosen(shop, key, angle);
    const { factBudget, questions } = await askGuideQuestions(products.map((p) => p.facts), angle, factsByHandle);
    const byHandle = new Map(products.map((p) => [p.facts.handle, p]));
    return {
      intent,
      error: null,
      angle,
      factBudget,
      questions: questions.map((x) => ({ q: x.q, why: x.why, product: byHandle.get(x.product)!.facts.title, productId: byHandle.get(x.product)!.id })),
    };
  } catch (e) {
    if (e instanceof Response) throw e;
    return { intent, error: e instanceof LlmError ? e.message : "Something went wrong. Please try again." };
  }
};

const answerLabel = (n: number) =>
  n >= 3 ? "Fully answerable from your product data" : n === 2 ? "Mostly answerable" : "A few extra details would help";

export default function GuidePage() {
  const { products, facts, savedAngles, chosen, articles } = useLoaderData<typeof loader>();
  const anglesF = useFetcher<ActionResult>();
  const questionsF = useFetcher<ActionResult>();
  const saveF = useFetcher<ActionResult>();
  const writeF = useFetcher<ActionResult>();
  const clearF = useFetcher<ActionResult>();
  const angles = anglesF.data?.angles ?? savedAngles;
  const anglesBusy = anglesF.state !== "idle";
  const questionsBusy = questionsF.state !== "idle";
  const anglesRef = useRef<HTMLDivElement>(null);
  const questionsRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const q = questionsF.data;
  const step = chosen ? 3 : 2;

  useEffect(() => {
    if (anglesF.data) anglesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [anglesF.data]);
  useEffect(() => {
    if (questionsF.data) questionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [questionsF.data]);
  useEffect(() => {
    if (saveF.data?.saved && q?.angle) questionsF.submit({ intent: "questions", angle: JSON.stringify(q.angle) }, { method: "POST" });
  }, [saveF.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const write = (angle: Angle) => writeF.submit({ intent: "write", angle: JSON.stringify(angle) }, { method: "POST" });

  return (
    <s-page heading="Buying guide">
      <s-link slot="breadcrumb-actions" href="/app/guide/new">Choose products</s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        {...(anglesBusy ? { loading: true } : {})}
        onClick={() => anglesF.submit({ intent: "angles" }, { method: "POST" })}
      >
        {angles.length ? "Refresh guide topics" : "Find guide topics"}
      </s-button>

      <s-banner tone="info" heading={step === 2 ? "Step 2 of 4: choose a topic" : "Step 3 of 4: check your facts"}>
        {step === 2
          ? angles.length
            ? "Select the topic you want the guide to cover, then press Continue."
            : 'Click "Find guide topics" (top right). We suggest what shoppers search for when choosing between these products.'
          : "Add any extra details below if you'd like (or skip this), then press Continue to write the guide."}
      </s-banner>

      <s-section heading="Products in this guide">
        <s-stack direction="block" gap="small">
          {products.map((p) => (
            <s-stack key={p.id} direction="inline" gap="small" alignItems="center">
              {p.imageUrl ? <s-thumbnail src={p.imageUrl} alt={p.title} size="small" /> : null}
              <s-text>{p.title}</s-text>
            </s-stack>
          ))}
          <s-stack direction="inline">
            <s-button href="/app/guide/new">Change products</s-button>
          </s-stack>
        </s-stack>
      </s-section>

      {step === 3 && chosen ? (
        <s-section heading="Your chosen topic">
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
        <s-section heading="Guides you've written with these products">
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

      {products.map((p) => (
        <FactsList
          key={p.id}
          heading={`Facts you've told us: ${p.title}`}
          facts={facts[p.id]}
          onRemove={(question) => saveF.submit({ intent: "delete", productId: p.id, question }, { method: "POST" })}
          onEdit={(question, answer) =>
            saveF.submit({ intent: "save", items: JSON.stringify([{ productId: p.id, question, answer, unknown: false }]) }, { method: "POST" })
          }
          saving={saveF.state !== "idle"}
        />
      ))}

      {anglesBusy ? (
        <s-banner tone="info" heading="Finding guide topics">
          Reading your product facts and thinking about what shoppers search for. This takes about 10 to 20 seconds.
        </s-banner>
      ) : null}

      <div ref={anglesRef} style={{ scrollMarginTop: 90 }} />
      {anglesF.data?.error ? <s-banner tone="critical" heading="We couldn't find topics">{anglesF.data.error}</s-banner> : null}

      {step === 2 && angles.length ? (
        <s-section heading="Suggested guide topics">
          <s-paragraph>These are AI suggestions based on your product facts. They are not measured search volumes.</s-paragraph>
          <s-stack direction="inline">
            <s-button {...(anglesBusy ? { loading: true } : {})} onClick={() => anglesF.submit({ intent: "angles", replace: "1" }, { method: "POST" })}>
              Replace these with new topics
            </s-button>
          </s-stack>
          <s-stack direction="block" gap="base">
            {angles.map((a, i) => (
              <s-box key={i} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-heading>{a.working_title}</s-heading>
                  <s-text>Target search: {a.target_query}</s-text>
                  <s-paragraph>{a.why_it_fits}</s-paragraph>
                  <s-stack direction="inline" gap="small">
                    <s-badge tone={a.answerable_from_data >= 2 ? "success" : "warning"}>{answerLabel(a.answerable_from_data)}</s-badge>
                    {a.risk === "high" ? <s-badge tone="critical">Health or safety topic: extra review</s-badge> : null}
                    {a.overlaps_existing ? <s-badge tone="warning">Similar to an existing article</s-badge> : null}
                  </s-stack>
                  {a.needs_info?.length ? <s-text>Would be better with: {a.needs_info.join("; ")}</s-text> : null}
                  <s-stack direction="inline">
                    <s-button variant={selected === i ? "primary" : "secondary"} onClick={() => setSelected(i)}>
                      {selected === i ? "Selected ✓" : "Select this topic"}
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      ) : null}

      {questionsBusy ? (
        <s-banner tone="info" heading="Checking what we still need from you">This takes a few seconds.</s-banner>
      ) : null}

      <div ref={questionsRef} style={{ scrollMarginTop: 90 }} />
      {q?.error ? <s-banner tone="critical" heading="We couldn't prepare the questions">{q.error}</s-banner> : null}
      {step === 3 && q?.angle && !q.error ? (
        <s-section heading={`Before we write: ${q.angle.working_title}`}>
          {saveF.data?.saved ? (
            <s-banner tone="success" heading="Saved">
              Your answers are saved as facts for these products. We've checked again for any other helpful details.
            </s-banner>
          ) : null}
          <QuestionForm
            key={q.angle.working_title + (q.questions?.length ?? 0)}
            angle={q.angle}
            questions={(q.questions ?? []).map((x) => ({ q: x.q, why: x.why, product: x.product }))}
            factBudget={q.factBudget ?? "low"}
            saving={saveF.state !== "idle"}
            writing={writeF.state !== "idle"}
            onWrite={() => write(q.angle!)}
            onSave={(items) =>
              saveF.submit(
                { intent: "save", items: JSON.stringify(items.map((it, i) => ({ ...it, productId: q.questions![i].productId }))) },
                { method: "POST" },
              )
            }
          />
        </s-section>
      ) : null}

      <s-section>
        <s-stack direction="inline" justifyContent="space-between" alignItems="center">
          {step === 2 ? (
            <s-button href="/app/guide/new">← Back to products</s-button>
          ) : (
            <s-button
              {...(clearF.state !== "idle" ? { loading: true } : {})}
              onClick={() => clearF.submit({ intent: "clear" }, { method: "POST" })}
            >
              ← Back to topics
            </s-button>
          )}
          {step === 2 ? (
            <s-button
              variant="primary"
              {...(selected === null || !angles.length ? { disabled: true } : {})}
              {...(questionsBusy ? { loading: true } : {})}
              onClick={() => selected !== null && questionsF.submit({ intent: "questions", angle: JSON.stringify(angles[selected]) }, { method: "POST" })}
            >
              Continue →
            </s-button>
          ) : (
            <s-button variant="primary" {...(writeF.state !== "idle" ? { loading: true } : {})} onClick={() => chosen && write(chosen)}>
              Continue: write the guide →
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
