import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { dedupeArticle, getArticle, saveEdits, setSent } from "../lib/articles.server";
import { loadEffectiveSettings } from "../lib/settings.server";
import { PublishError, sendToShopify } from "../lib/publish.server";
import type { Article, ArticleResult, SentInfo } from "../lib/pipeline/types";
import { getProduct } from "../lib/products.server";
import { renderMarkdown } from "../lib/markdown";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const article = await getArticle(session.shop, params.id!);
  if (!article) throw new Response("Article not found", { status: 404 });
  const product = await getProduct(admin, `gid://shopify/Product/${article.productId}`);
  const settings = await loadEffectiveSettings(admin, session.shop);
  return {
    article,
    handle: product?.facts.handle ?? "",
    productTitle: product?.facts.title ?? "",
    publishMode: settings.publishMode,
    store: session.shop.replace(".myshopify.com", ""),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "send" || intent === "update") {
    try {
      const art = await getArticle(session.shop, params.id!);
      if (!art?.result) return { saved: false, error: "This article isn't ready to send yet." };
      const product = await getProduct(admin, `gid://shopify/Product/${art.productId}`);
      if (!product) return { saved: false, error: "We couldn't find the product this article is about." };
      const settings = await loadEffectiveSettings(admin, session.shop);
      const { sent, warning } = await sendToShopify(admin, {
        article: art.result.article,
        angle: art.angle,
        productHandle: product.facts.handle,
        settings,
        shopName: settings.businessName,
        publish: form.get("mode") === "live",
        existing: intent === "update" ? art.result.sent ?? null : null,
      });
      await setSent(session.shop, params.id!, sent);
      return { saved: true, sentOk: true, warning };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const error =
        e instanceof PublishError
          ? e.message
          : /access denied|required access|scope/i.test(msg)
            ? "The app doesn't have permission to publish to your blog yet. Reopen the app and approve the updated permissions."
            : `Something went wrong sending to Shopify${msg ? `: ${msg.slice(0, 300)}` : "."} Please try again.`;
      if (!(e instanceof PublishError)) console.error("Send to Shopify failed", e);
      return { saved: false, error };
    }
  }
  if (form.get("intent") === "dedupe") {
    const result = await dedupeArticle(session.shop, params.id!);
    return { saved: !!result };
  }
  const article = JSON.parse(String(form.get("article"))) as Article;
  const result = await saveEdits(session.shop, params.id!, article);
  return { saved: !!result };
};

const setOf = (a: Article) => JSON.stringify(a);

function ArticleReview({
  r,
  back,
  productTitle,
  url,
  publishMode,
  store,
}: {
  r: ArticleResult;
  back: string;
  productTitle: string;
  url: string;
  publishMode: "draft" | "live";
  store: string;
}) {
  const fetcher = useFetcher<{ saved: boolean }>();
  const sendF = useFetcher<{ saved: boolean; error?: string; warning?: string; sentOk?: boolean }>();
  const sending = sendF.state !== "idle";
  const sent: SentInfo | undefined = r.sent;
  const send = (mode: "draft" | "live") => {
    if (mode === "live" && !window.confirm("Publish this article to your store's blog now? Anyone will be able to read it.")) return;
    sendF.submit({ intent: "send", mode }, { method: "POST" });
  };
  const adminUrl = sent ? `https://admin.shopify.com/store/${store}/content/articles/${sent.id.split("/").pop()}` : "";
  const [draft, setDraft] = useState<Article>(r.article);
  const dirty = setOf(draft) !== setOf(r.article);
  const saving = fetcher.state !== "idle";
  const ready = r.status === "READY FOR MERCHANT APPROVAL";
  const val = (e: Event) => (e.currentTarget as unknown as { value: string }).value;
  const set = <K extends keyof Article>(k: K, v: Article[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <s-page heading={draft.h1 || "Your article"}>
      <s-link slot="breadcrumb-actions" href={back}>{productTitle || "Product"}</s-link>
      {dirty ? (
        <>
          <s-button slot="secondary-actions" onClick={() => setDraft(r.article)}>Discard changes</s-button>
          <s-button
            slot="primary-action"
            variant="primary"
            {...(saving ? { loading: true } : {})}
            onClick={() => fetcher.submit({ article: JSON.stringify(draft) }, { method: "POST" })}
          >
            Save changes
          </s-button>
        </>
      ) : null}

      {ready ? (
        <s-banner tone="success" heading="Your article is ready!">
          Every claim is backed by your product facts. Review it below, edit anything you like, and copy it when you're happy.
        </s-banner>
      ) : (
        <s-banner tone="warning" heading="Nearly there">
          A few items below need a quick look before you use this article.
        </s-banner>
      )}
      {sendF.data?.error ? <s-banner tone="critical" heading="We couldn't send it to Shopify">{sendF.data.error}</s-banner> : null}
      {sendF.data?.warning ? <s-banner tone="warning">{sendF.data.warning}</s-banner> : null}

      <s-section heading="Send to your Shopify blog">
        {sent ? (
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone={sent.published ? "success" : "info"}>{sent.published ? "Published" : "Draft"}</s-badge>
              <s-text>
                {sent.published ? "This article is live on your blog." : "This article is saved as a draft in your blog."}
              </s-text>
            </s-stack>
            <s-stack direction="inline" gap="small">
              <s-button href={adminUrl} target="_blank">Open in Shopify</s-button>
              {sent.url ? <s-button href={sent.url} target="_blank">View on your store</s-button> : null}
              <s-button
                {...(sending ? { loading: true } : {})}
                {...(dirty ? { disabled: true } : {})}
                onClick={() => sendF.submit({ intent: "update", mode: sent.published ? "live" : "draft" }, { method: "POST" })}
              >
                Update in Shopify with my latest edits
              </s-button>
            </s-stack>
            {dirty ? <s-text color="subdued">Save your changes first, then update Shopify.</s-text> : null}
          </s-stack>
        ) : (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              {publishMode === "draft"
                ? "Your settings send articles to Shopify as drafts, so nothing goes live until you publish it."
                : "Your settings publish articles straight away."}
            </s-paragraph>
            <s-stack direction="inline" gap="small">
              <s-button
                variant="primary"
                {...(sending ? { loading: true } : {})}
                {...(dirty ? { disabled: true } : {})}
                onClick={() => send(publishMode)}
              >
                {publishMode === "draft" ? "Save as draft in Shopify" : "Publish to my blog"}
              </s-button>
              <s-button {...(sending ? { disabled: true } : {})} {...(dirty ? { disabled: true } : {})} onClick={() => send(publishMode === "draft" ? "live" : "draft")}>
                {publishMode === "draft" ? "Publish now instead" : "Save as draft instead"}
              </s-button>
            </s-stack>
            {dirty ? <s-text color="subdued">Save your changes first, then send.</s-text> : null}
          </s-stack>
        )}
      </s-section>

      {r.edited && !dirty ? (
        <s-banner tone="info" heading="Your edits are saved">
          We re-run our format checks after you save, but we don't fact-check your own changes.
        </s-banner>
      ) : null}

      {r.remaining.length || r.issues.length ? (
        <s-section heading="Things to check">
          <s-stack direction="block" gap="small">
            {r.remaining.some((p) => /^copies an earlier/.test(p.problem)) && !dirty ? (
              <s-stack direction="inline">
                <s-button
                  {...(saving ? { loading: true } : {})}
                  onClick={() => fetcher.submit({ intent: "dedupe" }, { method: "POST" })}
                >
                  Remove copied sentences
                </s-button>
              </s-stack>
            ) : null}
            {r.remaining.map((p, i) => (
              <s-text key={"p" + i}>
                <strong>"{p.text.replace(/\*\*/g, "").slice(0, 140)}"</strong> — {p.problem}
              </s-text>
            ))}
            {r.issues.map((i, n) => (
              <s-text key={"i" + n}>{i}</s-text>
            ))}
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading="Search listing">
        <s-stack direction="block" gap="base">
          <s-text-field
            label={`Title tag (${draft.title_tag.length}/60)`}
            value={draft.title_tag}
            onInput={(e) => set("title_tag", val(e as unknown as Event))}
          />
          <s-text-area
            label={`Meta description (${draft.meta_description.length}/155)`}
            rows={2}
            value={draft.meta_description}
            onInput={(e) => set("meta_description", val(e as unknown as Event))}
          />
          <s-text-field
            label="URL handle"
            value={draft.handle}
            onInput={(e) => set("handle", val(e as unknown as Event))}
          />
        </s-stack>
      </s-section>

      <s-section heading="Article">
        <s-stack direction="block" gap="base">
          <s-text-field label="Heading (H1)" value={draft.h1} onInput={(e) => set("h1", val(e as unknown as Event))} />
          <s-text-area
            label="TL;DR"
            rows={3}
            value={draft.tldr}
            onInput={(e) => set("tldr", val(e as unknown as Event))}
          />
          <s-text-area
            label="Body (markdown: ## for headings, - for bullets, **bold**)"
            rows={22}
            value={draft.body_markdown}
            onInput={(e) => set("body_markdown", val(e as unknown as Event))}
          />
        </s-stack>
      </s-section>

      <s-section heading="Frequently asked questions">
        <s-stack direction="block" gap="base">
          {draft.faq.map((f, i) => (
            <s-box key={i} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-text-field
                  label="Question"
                  value={f.q}
                  onInput={(e) => {
                    const v = val(e as unknown as Event);
                    set("faq", draft.faq.map((x, n) => (n === i ? { ...x, q: v } : x)));
                  }}
                />
                <s-text-area
                  label="Answer"
                  rows={3}
                  value={f.a}
                  onInput={(e) => {
                    const v = val(e as unknown as Event);
                    set("faq", draft.faq.map((x, n) => (n === i ? { ...x, a: v } : x)));
                  }}
                />
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Preview">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-heading>{draft.h1}</s-heading>
            <s-paragraph><strong>TL;DR:</strong> {draft.tldr}</s-paragraph>
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.body_markdown, url) }} />
            <s-heading>Frequently asked questions</s-heading>
            {draft.faq.map((f, i) => (
              <s-stack key={i} direction="block" gap="small-300">
                <s-text><strong>{f.q}</strong></s-text>
                <s-paragraph>{f.a}</s-paragraph>
              </s-stack>
            ))}
          </s-stack>
        </s-box>
      </s-section>

      {draft.missing_info_for_merchant?.length ? (
        <s-section heading="Facts that would make this article better">
          <s-unordered-list>
            {draft.missing_info_for_merchant.map((m, i) => (
              <s-list-item key={i}>{m}</s-list-item>
            ))}
          </s-unordered-list>
        </s-section>
      ) : null}

      <s-section heading="Email and social copy">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Email subject"
            value={draft.email_subject ?? ""}
            onInput={(e) => set("email_subject", val(e as unknown as Event))}
          />
          <s-text-area
            label="Email body"
            rows={8}
            value={draft.email_body ?? ""}
            onInput={(e) => set("email_body", val(e as unknown as Event))}
          />
          <s-text-area
            label="Social post"
            rows={4}
            value={draft.social_post ?? ""}
            onInput={(e) => set("social_post", val(e as unknown as Event))}
          />
          {draft.image_prompts?.length ? (
            <s-text><strong>Image ideas:</strong> {draft.image_prompts.join(" · ")}</s-text>
          ) : null}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export default function ArticlePage() {
  const { article, handle, productTitle, publishMode, store } = useLoaderData<typeof loader>();
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

  const url = handle ? `/products/${handle}` : "#";
  return <ArticleReview key={JSON.stringify(r)} r={r} back={back} productTitle={productTitle} url={url} publishMode={publishMode} store={store} />;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
