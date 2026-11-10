import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadRefreshList } from "../lib/refresh.server";
import { ageLabel } from "../lib/refresh";
import { SeoBadge } from "../components/ArticleBadges";
import { RulesPanel } from "../components/RulesPanel";
import { listProtected, setProtected } from "../lib/refreshStore.server";
import { cleanRules } from "../lib/refreshRules";
import { loadSettings } from "../lib/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const list = await loadRefreshList(admin, session.shop, 100);
  const protectedItems = (await listProtected(session.shop)).map((p) => ({ kind: p.kind, ref: p.ref, label: p.label }));
  const rules = cleanRules((await loadSettings(session.shop)).refreshRules);
  return { list, rules, protectedItems, store: session.shop.replace(".myshopify.com", "") };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") === "unprotect") {
    const kind = form.get("kind") === "blog" ? "blog" : "post";
    await setProtected(session.shop, kind, String(form.get("ref")), "", false);
  }
  return { ok: true };
};

const tone = (priority: number) => (priority >= 8 ? "critical" : priority >= 4 ? "warning" : "success");
const toneLabel = (priority: number) => (priority >= 8 ? "Look first" : priority >= 4 ? "Worth a look" : "Looks fine");

export default function Refresh() {
  const { list, rules, protectedItems, store } = useLoaderData<typeof loader>();
  const f = useFetcher();
  const flagged = list.reviews.filter((r) => r.signals.length).length;

  return (
    <s-page heading="AI Refresh">
      <s-link slot="breadcrumb-actions" href="/app">Home</s-link>
      <s-section>
        <s-stack direction="block" gap="small">
          <s-paragraph>
            We read your blog and look for posts that have drifted out of date: links to products or collections that are gone, years and prices that
            have changed, and the features and updates a newer post would have, like a short summary, an FAQ and links to your products. Nothing is
            changed in your store.
          </s-paragraph>
          <s-paragraph color="subdued">
            We checked the {list.shown} posts that haven't been updated for the longest time{list.totalPosts ? `, out of ${list.totalPosts} on your blog` : ""}.{" "}
            {flagged === 0 ? "None of them need attention right now." : flagged === list.shown ? "All of them could use a refresh." : `${flagged} of them could use a refresh.`}{" "}
            Choose "Review" on a post to see what we'd change, with a before and after, and update it in Shopify.
            {list.protectedCount ? ` ${list.protectedCount} post${list.protectedCount === 1 ? " is" : "s are"} set to never be refreshed and left out.` : ""}
          </s-paragraph>
          <RulesPanel rules={rules} />
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
              <s-table-header>{" "}</s-table-header>
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
                  <s-table-cell>
                    <s-button href={`/app/refresh/${r.post.id.split("/").pop()}`}>Review</s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
      {protectedItems.length ? (
        <s-section heading="Never refreshed">
          <s-stack direction="block" gap="small">
            {protectedItems.map((p) => (
              <s-stack key={p.kind + p.ref} direction="inline" gap="base" alignItems="center">
                <s-text>
                  {p.kind === "blog" ? "Whole blog: " : "Post: "}
                  {p.label || p.ref}
                </s-text>
                <s-button variant="tertiary" onClick={() => f.submit({ intent: "unprotect", kind: p.kind, ref: p.ref }, { method: "POST" })}>
                  Allow again
                </s-button>
              </s-stack>
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

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
