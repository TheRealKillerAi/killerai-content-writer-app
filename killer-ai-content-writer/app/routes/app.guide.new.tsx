import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listProducts, listProductTypes } from "../lib/products.server";
import { ProductFilters } from "../components/ProductFilters";
import { MAX_GUIDE_PRODUCTS } from "../lib/guide";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const type = url.searchParams.get("type") ?? "";
  const after = url.searchParams.get("after");
  const [{ products, pageInfo }, types] = await Promise.all([listProducts(admin, q, after, type), listProductTypes(admin)]);
  return { products, pageInfo, q, type, types };
};

const numericId = (gid: string) => gid.split("/").pop()!;

export default function NewGuide() {
  const { products, pageInfo, q, type, types } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [picked, setPicked] = useState<Record<string, string>>({}); // id -> title, kept across searches
  const ids = Object.keys(picked);
  const go = (params: Record<string, string>) => navigate(`/app/guide/new?${new URLSearchParams(params).toString()}`);
  const toggle = (id: string, title: string, on: boolean) =>
    setPicked((p) => {
      const next = { ...p };
      if (on) next[id] = title;
      else delete next[id];
      return next;
    });
  const tooMany = ids.length > MAX_GUIDE_PRODUCTS;

  return (
    <s-page heading="Choose products for your buying guide">
      <s-link slot="breadcrumb-actions" href="/app/new">New article</s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        {...(ids.length < 2 || tooMany ? { disabled: true } : {})}
        onClick={() => navigate(`/app/guide/${ids.join("-")}`)}
      >
        Continue with {ids.length || ""} product{ids.length === 1 ? "" : "s"} →
      </s-button>

      <s-banner tone="info" heading="Step 1 of 4: choose the products">
        Select between 2 and {MAX_GUIDE_PRODUCTS} products that shoppers would choose between. Your guide will link to each one.
        {tooMany ? ` You've picked ${ids.length}, so please deselect a few.` : ""}
      </s-banner>

      <s-section>
        <ProductFilters q={q} type={type} types={types} go={go} />
        {ids.length ? (
          <s-box paddingBlockStart="base">
            <s-paragraph><strong>Selected {ids.length} of {MAX_GUIDE_PRODUCTS}:</strong> {Object.values(picked).join(" · ")}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section padding="none">
        {products.length === 0 ? (
          <s-box padding="large">
            <s-paragraph>No products found{q ? ` for "${q}"` : ""}{type ? ` of type "${type}"` : ""}.</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Type</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {products.map((p) => {
                const id = numericId(p.id);
                return (
                  <s-table-row key={p.id}>
                    <s-table-cell>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 220, maxWidth: 440, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                        <s-checkbox
                          label={p.title}
                          labelAccessibilityVisibility="exclusive"
                          checked={id in picked}
                          onChange={(e) => toggle(id, p.title, (e.currentTarget as unknown as { checked: boolean }).checked)}
                        />
                        {p.imageUrl ? <s-thumbnail src={p.imageUrl} alt={p.title} size="small" /> : null}
                        <span>{p.title}</span>
                      </div>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={p.status === "ACTIVE" ? "success" : "neutral"}>{p.status.toLowerCase()}</s-badge>
                    </s-table-cell>
                    <s-table-cell>{p.productType || "—"}</s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section>
        <s-stack direction="inline" justifyContent="space-between" alignItems="center">
          {pageInfo.hasNextPage && pageInfo.endCursor ? (
            <s-button onClick={() => go({ ...(q ? { q } : {}), ...(type ? { type } : {}), after: pageInfo.endCursor as string })}>More products</s-button>
          ) : (
            <span />
          )}
          <s-button
            variant="primary"
            {...(ids.length < 2 || tooMany ? { disabled: true } : {})}
            onClick={() => navigate(`/app/guide/${ids.join("-")}`)}
          >
            Continue with {ids.length || ""} product{ids.length === 1 ? "" : "s"} →
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
