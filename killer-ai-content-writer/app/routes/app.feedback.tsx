import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { saveFeedback, SUPPORT_EMAIL } from "../lib/feedback.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const from = new URL(request.url).searchParams.get("from") ?? "";
  return { from, email: SUPPORT_EMAIL };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const f = await request.formData();
  const intent = String(f.get("intent"));
  const context = String(f.get("context") ?? "");
  if (intent === "thumb") {
    const ok = await saveFeedback(session.shop, {
      kind: "thumb",
      rating: Number(f.get("rating")),
      message: String(f.get("message") ?? ""),
      context,
    });
    return { ok };
  }
  const message = String(f.get("message") ?? "");
  const ok = await saveFeedback(session.shop, { kind: "message", message, context });
  return { ok, error: ok ? null : "Please write a short message first." };
};

export default function Feedback() {
  const { from, email } = useLoaderData<typeof loader>();
  const f = useFetcher<{ ok: boolean; error?: string | null }>();
  const [message, setMessage] = useState("");
  const sent = f.data?.ok && f.state === "idle";

  return (
    <s-page heading="Send feedback">
      <s-link slot="breadcrumb-actions" href="/app/help">Help</s-link>
      <s-section>
        {sent ? (
          <s-banner tone="success" heading="Thank you">
            We've received your message and read every one.
          </s-banner>
        ) : (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Tell us what's working, what isn't, or what you'd love to see. If something went wrong, include what you
              were doing at the time.
            </s-paragraph>
            {f.data?.error ? <s-banner tone="critical">{f.data.error}</s-banner> : null}
            <s-text-area
              label="Your message"
              rows={6}
              value={message}
              onInput={(e) => setMessage((e.currentTarget as unknown as { value: string }).value)}
            />
            <div>
              <s-button
                variant="primary"
                {...(f.state !== "idle" ? { loading: true } : {})}
                onClick={() => f.submit({ intent: "message", message, context: from }, { method: "POST" })}
              >
                Send feedback
              </s-button>
            </div>
          </s-stack>
        )}
      </s-section>
      <s-section>
        <s-text color="subdued">
          Prefer email? Write to <s-link href={`mailto:${email}`}>{email}</s-link>.
        </s-text>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
