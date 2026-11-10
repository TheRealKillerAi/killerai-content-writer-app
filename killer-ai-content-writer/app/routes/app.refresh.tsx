import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadRefreshList } from "../lib/refresh.server";
import { ageLabel } from "../lib/refresh";
import { SeoBadge } from "../components/ArticleBadges";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const list = await loadRefreshList(admin, 100);
  return { list, store: session.shop.replace(".myshopify.com", "") };
};

const tone = (priority: number) => (priority >= 8 ? "critical" : priority >= 4 ? "warning" : "success");
const toneLabel = (priority: number) => (priority >= 8 ? "Look first" : priority >= 4 ? "Worth a look" : "Looks fine");

export default function Refresh() {
  const { list, store } = useLoaderData<typeof loader>();
  const flagged = list.reviews.filter((r) => r.signals.length).length;

  return (
    <s-page heading="Refresh your old posts">
      <s-link slot="breadcrumb-actions" href="/app">Home</s-link>
      <s-section>
        <s-stack direction="block" gap="small">
          <s-paragraph>
            We read your blog and look for posts that have drifted out of date: links to products or collections that are gone, years and prices that
            have changed, and basics a newer post would have. Nothing is changed in your store.
          </s-paragraph>
          <s-paragraph color="subdued">
            Showing the {list.shown} posts that were updated longest ago{list.totalPosts ? ` (of ${list.totalPosts})` : ""}; {flagged} {flagged === 1 ? "has" : "have"} something to look at.
            Reviewing each change and updating a post from here is coming next. For now, open a post in Shopify to edit it.
          </s-paragraph>
          {list.skippedChecks.length ? (
            <s-paragraph color="subdued">We skipped the check on {list.skippedChecks.join(" and ")} because your store has too many to read at once.</s-paragraph>
          ) : null}
        </s-stack>
      </s-section>
      <s-section padding="none">
        {list.reviews.length === 0 ? (
          <s-box padding="large">
            <s-paragraph>No published blog posts found yet.</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Post</s-table-header>
              <s-table-header>Priority</s-table-header>
              <s-table-header>What looks out of date</s-table-header>
              <s-table-header>SEO</s-table-header>
              <s-table-header>AI ready</s-table-header>
              <s-table-header>Words</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {list.reviews.map((r) => (
                <s-table-row key={r.post.id}>
                  <s-table-cell>
                    <div style={{ minWidth: 240, maxWidth: 420, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                      <s-link href={`https://admin.shopify.com/store/${store}/content/articles/${r.post.id.split("/").pop()}`} target="_blank">
                        {r.post.title}
                      </s-link>
                      <div>
                        <s-text color="subdued">
                          {r.post.blogTitle} · updated {ageLabel(r.ageMonths)}
                        </s-text>
                      </div>
                    </div>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={tone(r.priority)}>{toneLabel(r.priority)}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <div style={{ minWidth: 220, maxWidth: 420, whiteSpace: "normal" }}>
                      {r.signals.length ? (
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {r.signals.map((s) => (
                            <li key={s.id}>{s.label}</li>
                          ))}
                        </ul>
                      ) : (
                        <s-text color="subdued">Nothing found</s-text>
                      )}
                    </div>
                  </s-table-cell>
                  <s-table-cell>
                    <SeoBadge seo={r.seo} />
                  </s-table-cell>
                  <s-table-cell>
                    {r.ai.passed} of {r.ai.total}
                  </s-table-cell>
                  <s-table-cell>{r.words}</s-table-cell>
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

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
