import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

// Placeholder landing page so upgrade links across the app have somewhere to point. Plans and billing come later.
export default function Plans() {
  return (
    <s-page heading="Plans">
      <s-link slot="breadcrumb-actions" href="/app/settings">Settings</s-link>
      <s-section>
        <s-paragraph>Plans are coming soon.</s-paragraph>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
