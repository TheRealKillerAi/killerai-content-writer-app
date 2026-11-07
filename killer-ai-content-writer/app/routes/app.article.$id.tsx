import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getArticle } from "../lib/articles.server";
import { getProduct } from "../lib/products.server";
import { renderMarkdown } from "../lib/markdown";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const article = await getArticle(session.shop, params.id!);
  if (!article) throw new Response("Article not found", { status: 404 });
  const product = await getProduct(admin, `gid://shopify/Product/${article.productId}`);
  return { article, handle: product?.facts.handle ?? "", productTitle: product?.facts.title ?? "" };
};

export default function ArticlePage() {
  const { article, handle, productTitle } = useLoaderData<typeof loader>();
  const { revalidate, state } = useRevalidator();

  useEffect(() => {
    if (article.state !== "writing") return;
    const t = setInterval(() => {
      if (state === "idle") revalidate();
    }, 3000);
    return () => clearInterval(t);
  }, [article.state, state, revalidate]);

  const back = `/app/product/${article.productId}`;
  const r = article.result;

  if (article.state === "writing") {
    return (
      <s-page heading="Writing your article">
        <s-link slot="breadcrumb-actions" href={back}>{productTitle || "Product"}</s-link>
        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-spinner accessibilityLabel="Working" />
              <s-heading>{article.stage}…</s-heading>
            </s-stack>
            <s-paragraph>
              "{article.angle.working_title}". Every sentence is checked against your product facts, and anything we
              can't support is rewritten or removed. This usually takes one to two minutes. You can stay on this page.
            </s-paragraph>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  if (article.state === "failed" || !r) {
    return (
      <s-page heading="We couldn't write the article">
        <s-link slot="breadcrumb-actions" href={back}>{productTitle || "Product"}</s-link>
        <s-banner tone="critical" heading="Something went wrong">{article.error ?? "Please try again."}</s-banner>
        <s-section>
          <s-button href={back}>Back to the product</s-button>
        </s-section>
      </s-page>
    );
  }

  const a = r.article;
  const url = handle ? `/products/${handle}` : "#";
  const ready = r.status === "READY FOR MERCHANT APPROVAL";

  return (
    <s-page heading={a.h1}>
      <s-link slot="breadcrumb-actions" href={back}>{productTitle || "Product"}</s-link>

      {ready ? (
        <s-banner tone="success" heading="Ready for your approval">
          Every claim in this article is backed by your product facts. {r.words} words.
        </s-banner>
      ) : (
        <s-banner tone="warning" heading="Needs your review">
          We found things to check before you use this article. They are listed below. {r.words} words.
        </s-banner>
      )}

      {r.remaining.length || r.issues.length ? (
        <s-section heading="Things to check">
          <s-stack direction="block" gap="small">
            {r.remaining.map((p, i) => (
              <s-text key={"p" + i}>
                <strong>"{p.text.slice(0, 140)}{p.text.length > 140 ? "…" : ""}"</strong> — {p.problem}
              </s-text>
            ))}
            {r.issues.map((i, n) => (
              <s-text key={"i" + n}>{i}</s-text>
            ))}
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading="Search listing">
        <s-stack direction="block" gap="small">
          <s-text><strong>Title tag ({a.title_tag.length}/60):</strong> {a.title_tag}</s-text>
          <s-text><strong>Meta description ({a.meta_description.length}/155):</strong> {a.meta_description}</s-text>
          <s-text><strong>URL handle:</strong> {a.handle}</s-text>
        </s-stack>
      </s-section>

      <s-section heading="Article">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-paragraph><strong>TL;DR:</strong> {a.tldr}</s-paragraph>
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(a.body_markdown, url) }} />
            <s-heading>Frequently asked questions</s-heading>
            {a.faq.map((f, i) => (
              <s-stack key={i} direction="block" gap="small-300">
                <s-text><strong>{f.q}</strong></s-text>
                <s-paragraph>{f.a}</s-paragraph>
              </s-stack>
            ))}
          </s-stack>
        </s-box>
      </s-section>

      {a.missing_info_for_merchant?.length ? (
        <s-section heading="Facts that would make this article better">
          <s-unordered-list>
            {a.missing_info_for_merchant.map((m, i) => (
              <s-list-item key={i}>{m}</s-list-item>
            ))}
          </s-unordered-list>
        </s-section>
      ) : null}

      <s-section heading="Email and social copy (copy and paste)">
        <s-stack direction="block" gap="base">
          {a.email_subject ? <s-text><strong>Email subject:</strong> {a.email_subject}</s-text> : null}
          {a.email_body ? <s-paragraph>{a.email_body}</s-paragraph> : null}
          {a.social_post ? <s-paragraph><strong>Social post:</strong> {a.social_post}</s-paragraph> : null}
          {a.image_prompts?.length ? (
            <s-text><strong>Image ideas:</strong> {a.image_prompts.join(" · ")}</s-text>
          ) : null}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
