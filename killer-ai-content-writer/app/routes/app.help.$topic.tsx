import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { HELP_TOPICS } from "../lib/help";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const topic = HELP_TOPICS.find((t) => t.slug === params.topic);
  if (!topic) throw new Response("Help page not found", { status: 404 });
  return { topic };
};

export default function HelpTopic() {
  const { topic } = useLoaderData<typeof loader>();
  return (
    <s-page heading={topic.title}>
      <s-link slot="breadcrumb-actions" href="/app/help">Help</s-link>
      <s-section>
        <s-stack direction="block" gap="base">
          {topic.blocks.map((b, i) => (
            <s-stack key={i} direction="block" gap="small">
              {b.h ? <s-heading>{b.h}</s-heading> : null}
              {b.p ? <s-paragraph>{b.p}</s-paragraph> : null}
              {b.list ? (
                <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
                  {b.list.map((li) => (
                    <li key={li}>{li}</li>
                  ))}
                </ul>
              ) : null}
            </s-stack>
          ))}
        </s-stack>
      </s-section>
      <s-section>
        <s-button href="/app/help">← All help topics</s-button>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
