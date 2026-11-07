import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { existingArticleTitles, getProduct } from "../lib/products.server";
import { findAngles } from "../lib/pipeline/angles.server";
import { LlmError } from "../lib/pipeline/llm.server";
import type { Angle } from "../lib/pipeline/types";

const gidFor = (id: string) => `gid://shopify/Product/${id}`;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const product = await getProduct(admin, gidFor(params.id!));
  if (!product) throw new Response("Product not found", { status: 404 });
  return { product };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const product = await getProduct(admin, gidFor(params.id!));
  if (!product) return { error: "Product not found." as string, angles: [] as Angle[] };
  try {
    const existing = await existingArticleTitles(admin);
    const { angles } = await findAngles(product.facts, existing);
    return { error: null as string | null, angles };
  } catch (e) {
    const message = e instanceof LlmError ? e.message : "Something went wrong while finding angles.";
    return { error: message, angles: [] as Angle[] };
  }
};

function answerLabel(n: number) {
  return n >= 3 ? "Fully answerable from your product data" : n === 2 ? "Mostly answerable" : "Needs more facts from you";
}

export default function ProductPage() {
  const { product } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const angles = fetcher.data?.angles ?? [];
  const f = product.facts;

  return (
    <s-page heading={f.title}>
      <s-link slot="breadcrumb-actions" href="/app">Products</s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        {...(busy ? { loading: true } : {})}
        onClick={() => fetcher.submit({}, { method: "POST" })}
      >
        Find article angles
      </s-button>

      <s-section heading="What we know about this product">
        <s-stack direction="block" gap="small">
          <s-paragraph>
            The article can only state facts found here (plus anything you add later). If something is missing from
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

      {fetcher.data?.error ? (
        <s-banner tone="critical" heading="We couldn't find angles">
          {fetcher.data.error}
        </s-banner>
      ) : null}

      {angles.length ? (
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
                  {a.needs_info?.length ? (
                    <s-text>Would be better with: {a.needs_info.join("; ")}</s-text>
                  ) : null}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
