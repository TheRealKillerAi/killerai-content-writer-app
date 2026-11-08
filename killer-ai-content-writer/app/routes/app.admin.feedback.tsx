import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { isAdminShop, listFeedback } from "../lib/feedback.server";

// Owner-only: other merchants get a 404, so nobody sees another store's feedback.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isAdminShop(session.shop)) throw new Response("Not found", { status: 404 });
  const rows = await listFeedback();
  return {
    rows: rows.map((r) => ({
      id: r.id,
      when: r.createdAt.toISOString().slice(0, 16).replace("T", " "),
      shop: r.shop.replace(".myshopify.com", ""),
      kind: r.kind,
      rating: r.rating,
      context: r.context ?? "",
      message: r.message ?? "",
    })),
  };
};

export default function AdminFeedback() {
  const { rows } = useLoaderData<typeof loader>();
  const up = rows.filter((r) => r.rating === 1).length;
  const down = rows.filter((r) => r.rating === -1).length;
  return (
    <s-page heading="Feedback inbox">
      <s-link slot="breadcrumb-actions" href="/app/help">Help</s-link>
      <s-section>
        <s-text>
          {rows.length} items (newest first) · 👍 {up} · 👎 {down}
        </s-text>
      </s-section>
      <s-section padding="none">
        {rows.length === 0 ? (
          <s-box padding="large">
            <s-paragraph>No feedback yet.</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Message</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>From</s-table-header>
              <s-table-header>Where</s-table-header>
              <s-table-header>When (UTC)</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>{r.message || "—"}</s-table-cell>
                  <s-table-cell>
                    {r.kind === "thumb" ? (
                      <s-badge tone={r.rating === 1 ? "success" : "critical"}>{r.rating === 1 ? "👍" : "👎"}</s-badge>
                    ) : (
                      <s-badge>Message</s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>{r.shop}</s-table-cell>
                  <s-table-cell>{r.context || "—"}</s-table-cell>
                  <s-table-cell>{r.when}</s-table-cell>
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
