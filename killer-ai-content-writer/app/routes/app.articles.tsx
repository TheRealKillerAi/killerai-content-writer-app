import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { deleteArticle, listArticles } from "../lib/articles.server";
import { productTitles } from "../lib/products.server";
import { SeoBadge, StatusBadges } from "../components/ArticleBadges";
import { UsageMeter } from "../components/UsageMeter";
import { monthlyUsage } from "../lib/usage.server";
import { firstProductId, parseGuideKey } from "../lib/guide";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const articles = await listArticles(session.shop);
  const titles = await productTitles(admin, articles.map((a) => firstProductId(a.productId)));
  return { articles, titles, usage: await monthlyUsage(session.shop) };
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
  const { articles, titles, usage } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return (
    <s-page heading="Your articles">
      <s-link slot="breadcrumb-actions" href="/app">Home</s-link>
      <s-button slot="primary-action" variant="primary" href="/app/new">Write an article</s-button>
      <s-section>
        <UsageMeter usage={usage} />
      </s-section>
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
              <s-table-header>SEO</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Created</s-table-header>
              <s-table-header />
            </s-table-header-row>
            <s-table-body>
              {articles.map((a) => (
                <s-table-row key={a.id}>
                  <s-table-cell>
                    <div style={{ minWidth: 240, maxWidth: 560, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                      <s-link href={`/app/article/${a.id}`}>{a.title}</s-link>
                      <div style={{ opacity: 0.7, fontSize: 13, marginTop: 2 }}>
                        {parseGuideKey(a.productId) ? "Buying guide" : titles[a.productId] ?? "—"}
                        {a.keyword ? ` · ${a.keyword}` : ""}
                      </div>
                    </div>
                  </s-table-cell>
                  <s-table-cell><SeoBadge seo={a.seo} /></s-table-cell>
                  <s-table-cell><StatusBadges a={a} /></s-table-cell>
                  <s-table-cell>{fmt(a.createdAt)}</s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => {
                        if (window.confirm("Delete this article? This can't be undone.")) {
                          fetcher.submit({ intent: "delete", id: a.id }, { method: "POST" });
                        }
                      }}
                    >
                      Delete
                    </s-button>
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
