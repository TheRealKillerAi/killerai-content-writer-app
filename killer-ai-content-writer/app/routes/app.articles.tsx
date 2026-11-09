import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { deleteArticle, listArticles } from "../lib/articles.server";
import { productTitles } from "../lib/products.server";
import { firstProductId, parseGuideKey } from "../lib/guide";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const articles = await listArticles(session.shop);
  const titles = await productTitles(admin, articles.map((a) => firstProductId(a.productId)));
  return { articles, titles };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") === "delete") await deleteArticle(session.shop, String(form.get("id")));
  return { ok: true };
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function Articles() {
  const { articles, titles } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return (
    <s-page heading="Your articles">
      <s-section padding="none">
        {articles.length === 0 ? (
          <s-box padding="large">
            <s-paragraph>No articles yet. Start your first one.</s-paragraph>
            <s-button href="/app/new">Write an article</s-button>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Article</s-table-header>
              <s-table-header>Product</s-table-header>
              <s-table-header>Search phrase</s-table-header>
              <s-table-header>SEO score</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Created</s-table-header>
              <s-table-header />
            </s-table-header-row>
            <s-table-body>
              {articles.map((a) => (
                <s-table-row key={a.id}>
                  <s-table-cell>
                    <s-link href={`/app/article/${a.id}`}>{a.title}</s-link>
                  </s-table-cell>
                  <s-table-cell>{parseGuideKey(a.productId) ? "Buying guide" : titles[a.productId] ?? "—"}</s-table-cell>
                  <s-table-cell>{a.keyword || "—"}</s-table-cell>
                  <s-table-cell>
                    {a.seo === null ? "—" : <s-badge tone={a.seo >= 80 ? "success" : a.seo >= 60 ? "warning" : "critical"}>{String(Math.round(a.seo))}</s-badge>}
                  </s-table-cell>
                  <s-table-cell>
                    {a.state === "writing" ? (
                      <s-badge tone="info">Writing…</s-badge>
                    ) : a.state === "failed" ? (
                      <s-badge tone="critical">Failed</s-badge>
                    ) : a.status === "READY FOR MERCHANT APPROVAL" ? (
                      <s-badge tone="success">Ready</s-badge>
                    ) : (
                      <s-badge tone="warning">Needs review</s-badge>
                    )}
                    {a.sentAs ? <s-badge tone={a.sentAs === "live" ? "success" : "neutral"}>{a.sentAs === "live" ? "On blog" : "Blog draft"}</s-badge> : null}
                  </s-table-cell>
                  <s-table-cell>{fmt(a.createdAt)}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      <s-button href={`/app/article/${a.id}`}>Open</s-button>
                      <s-button
                        tone="critical"
                        onClick={() => {
                          if (window.confirm("Delete this article? This can't be undone.")) {
                            fetcher.submit({ intent: "delete", id: a.id }, { method: "POST" });
                          }
                        }}
                      >
                        Delete
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
