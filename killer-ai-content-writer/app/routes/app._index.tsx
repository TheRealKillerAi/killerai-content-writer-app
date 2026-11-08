import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listArticles } from "../lib/articles.server";
import { loadSettings } from "../lib/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [settings, articles] = await Promise.all([loadSettings(session.shop), listArticles(session.shop)]);
  return {
    voiceDone: settings.brandDescription.trim().length > 0,
    wroteDone: articles.some((a) => a.state === "done"),
    recent: articles.slice(0, 5),
  };
};

const STEPS = [
  { n: "1", title: "Pick a product", text: "Choose any product in your store. Its details on Shopify are the source of truth." },
  { n: "2", title: "Choose a topic", text: "We suggest what shoppers are searching for. Pick the one you like and add any extra details you'd like included." },
  { n: "3", title: "Review and publish", text: "Every sentence is checked against your product information. Fine-tune the wording if you like, then send it to your blog." },
];

const POINTS = [
  { title: "Facts first", text: "Claims about your product come only from your product page and the details you share." },
  { title: "Sounds like you", text: "Set your brand voice once and every article follows it." },
  { title: "Built for search and AI", text: "Clear headings, a direct answer up top, a short summary and FAQs, so your articles suit both search engines and AI answers." },
  { title: "More than a blog post", text: "Each article comes with email and social copy and image ideas, ready to copy and paste." },
];

export default function Home() {
  const { voiceDone, wroteDone, recent } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Welcome to KillerAi Content Writer">
      <s-button slot="primary-action" variant="primary" href="/app/new">Write an article</s-button>

      <s-section>
        <s-stack direction="block" gap="base">
          <s-heading>Blog articles that sound like you and stick to the facts</s-heading>
          <s-paragraph>
            Pick a product and we research what shoppers search for, then write an article for your blog in your
            brand's voice. Every claim is checked against your own product information, so you can publish with
            confidence.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Get started">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone={voiceDone ? "success" : "neutral"}>{voiceDone ? "Done" : "To do"}</s-badge>
              <s-text>Set your brand voice</s-text>
            </s-stack>
            <s-button href="/app/settings">{voiceDone ? "Review" : "Open settings"}</s-button>
          </s-stack>
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone={wroteDone ? "success" : "neutral"}>{wroteDone ? "Done" : "To do"}</s-badge>
              <s-text>Write your first article</s-text>
            </s-stack>
            <s-button variant={wroteDone ? "secondary" : "primary"} href="/app/new">Write an article</s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="How it works">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
          {STEPS.map((s) => (
            <s-box key={s.n} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-badge>{`Step ${s.n}`}</s-badge>
                <s-heading>{s.title}</s-heading>
                <s-paragraph>{s.text}</s-paragraph>
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Why KillerAi Content Writer">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
          {POINTS.map((p) => (
            <s-box key={p.title} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-heading>{p.title}</s-heading>
                <s-paragraph>{p.text}</s-paragraph>
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      </s-section>

      {recent.length ? (
        <s-section heading="Recent articles">
          <s-stack direction="block" gap="small">
            {recent.map((a) => (
              <s-stack key={a.id} direction="inline" gap="small" alignItems="center">
                <s-link href={`/app/article/${a.id}`}>{a.title}</s-link>
                {a.state === "writing" ? (
                  <s-badge tone="info">Writing…</s-badge>
                ) : a.state === "failed" ? (
                  <s-badge tone="critical">Failed</s-badge>
                ) : a.status === "READY FOR MERCHANT APPROVAL" ? (
                  <s-badge tone="success">Ready</s-badge>
                ) : (
                  <s-badge tone="warning">Needs review</s-badge>
                )}
              </s-stack>
            ))}
            <s-stack direction="inline">
              <s-button href="/app/articles">See all articles</s-button>
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
