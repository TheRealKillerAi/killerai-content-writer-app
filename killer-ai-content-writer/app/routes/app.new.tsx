import type { HeadersFunction } from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

const TYPES = [
  {
    key: "product",
    title: "Product-focused",
    text: "Write about one of your products: how to use it, what it's for, how it compares, or the questions shoppers ask before buying.",
    best: "Every claim is checked against your product information.",
    href: "/app/products",
    cta: "Choose a product",
    available: true,
  },
  {
    key: "guide",
    title: "Buying guide",
    text: "Help shoppers choose between several of your products, or find the right one for their needs.",
    best: "Draws on the facts of each product you include.",
    available: false,
  },
  {
    key: "topic",
    title: "Topic-focused",
    text: "Answer a question your customers ask that isn't about one product, such as care tips or how to get started.",
    best: "Uses the details you provide, so we'll ask you for the facts to include.",
    available: false,
  },
];

export default function NewArticle() {
  return (
    <s-page heading="What would you like to write?">
      <s-link slot="breadcrumb-actions" href="/app">Home</s-link>
      <s-section>
        <s-paragraph>Choose the type of article. This shapes the ideas we suggest and the facts we use.</s-paragraph>
      </s-section>
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="base">
          {TYPES.map((t) => (
            <s-box key={t.key} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-heading>{t.title}</s-heading>
                  {t.available ? null : <s-badge>Coming soon</s-badge>}
                </s-stack>
                <s-paragraph>{t.text}</s-paragraph>
                <s-text color="subdued">{t.best}</s-text>
                {t.available ? (
                  <s-stack direction="inline">
                    <s-button variant="primary" href={t.href}>{t.cta}</s-button>
                  </s-stack>
                ) : null}
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      </s-section>
      <s-section>
        <s-text color="subdued">
          Recipe posts, gift guides and new-product announcements are planned for later.
        </s-text>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
