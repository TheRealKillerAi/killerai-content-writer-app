import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { UsageMeter } from "../components/UsageMeter";
import { monthlyUsage } from "../lib/usage.server";
import { authenticate } from "../shopify.server";
import { listProducts, listProductTypes } from "../lib/products.server";
import { ProductFilters } from "../components/ProductFilters";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const type = url.searchParams.get("type") ?? "";
  const after = url.searchParams.get("after");
  const [{ products, pageInfo }, types] = await Promise.all([listProducts(admin, q, after, type), listProductTypes(admin)]);
  return { products, pageInfo, q, type, types, usage: await monthlyUsage(session.shop) };
};

const productPath = (gid: string) => `/app/product/${gid.split("/").pop()}`;

export default function Products() {
  const { products, pageInfo, q, type, types, usage } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const go = (params: Record<string, string>) => navigate(`/app/products?${new URLSearchParams(params).toString()}`);

  return (
    <s-page heading="Choose a product to write about">
      <s-link slot="breadcrumb-actions" href="/app">Home</s-link>
      <s-section>
        <UsageMeter usage={usage} />
      </s-section>
      <s-section>
        <ProductFilters q={q} type={type} types={types} go={go} />
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
              <s-table-header />
            </s-table-header-row>
            <s-table-body>
              {products.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 180, maxWidth: 420, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                      {p.imageUrl ? <s-thumbnail src={p.imageUrl} alt={p.title} size="small" /> : null}
                      <s-link href={productPath(p.id)}>{p.title}</s-link>
                    </div>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={p.status === "ACTIVE" ? "success" : "neutral"}>{p.status.toLowerCase()}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{p.productType || "—"}</s-table-cell>
                  <s-table-cell>
                    <s-button variant="primary" href={productPath(p.id)}>Write article</s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {pageInfo.hasNextPage && pageInfo.endCursor ? (
        <s-section>
          <s-button onClick={() => go({ ...(q ? { q } : {}), ...(type ? { type } : {}), after: pageInfo.endCursor as string })}>
            Next page
          </s-button>
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
