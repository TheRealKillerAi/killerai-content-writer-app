import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { HELP_TOPICS } from "../lib/help";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Help() {
  return (
    <s-page heading="Help">
      <s-link slot="breadcrumb-actions" href="/app">Home</s-link>
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="base">
          {HELP_TOPICS.map((t) => (
            <s-box key={t.slug} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-heading>{t.title}</s-heading>
                <s-paragraph>{t.summary}</s-paragraph>
                <s-stack direction="inline">
                  <s-button href={`/app/help/${t.slug}`}>Read</s-button>
                </s-stack>
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      </s-section>
      <s-section>
        <s-text color="subdued">Need something else? Email hello@killerai.au.</s-text>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
