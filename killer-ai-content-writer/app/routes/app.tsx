import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { isAdminShop } from "../lib/feedback.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", isAdmin: isAdminShop(session.shop) };
};

export default function App() {
  const { apiKey, isAdmin } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/products">Products</s-link>
        <s-link href="/app/articles">Articles</s-link>
        <s-link href="/app/refresh">Refresh</s-link>
        <s-link href="/app/schedule">Schedule</s-link>
        <s-link href="/app/authors">Authors</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/help">Help</s-link>
        {isAdmin ? <s-link href="/app/admin/feedback">Feedback inbox</s-link> : null}
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
