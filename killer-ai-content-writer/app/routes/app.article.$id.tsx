import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { dedupeArticle, getArticle, saveEdits, setSent } from "../lib/articles.server";
import { loadEffectiveSettings } from "../lib/settings.server";
import { PublishError, sendToShopify } from "../lib/publish.server";
import type { Article, ArticleResult, SentInfo } from "../lib/pipeline/types";
import { getProduct, productImages, type ProductImage } from "../lib/products.server";
import type { AppSettings } from "../lib/settings";
import { buildBodyHtml } from "../lib/articleHtml";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const article = await getArticle(session.shop, params.id!);
  if (!article) throw new Response("Article not found", { status: 404 });
  const product = await getProduct(admin, `gid://shopify/Product/${article.productId}`);
  const settings = await loadEffectiveSettings(admin, session.shop);
  const images = await productImages(admin, `gid://shopify/Product/${article.productId}`);
  return {
    images,
    tldrStyle: {
      tldrEnabled: settings.tldrEnabled,
      tldrLabel: settings.tldrLabel,
      tldrBg: settings.tldrBg,
      tldrText: settings.tldrText,
      tldrCorners: settings.tldrCorners,
      tldrFontSize: settings.tldrFontSize,
      tldrFont: settings.tldrFont,
    },
    article,
    handle: product?.facts.handle ?? "",
    productTitle: product?.facts.title ?? "",
    publishMode: settings.publishMode,
    toc: settings.toc,
    author: settings.defaultAuthor.trim() || settings.businessName,
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
  images,
  tldrStyle,
  toc,
  author,
  handle,
}: {
  images: ProductImage[];
  toc: boolean;
  author: string;
  handle: string;
  tldrStyle: Pick<AppSettings, "tldrEnabled" | "tldrLabel" | "tldrBg" | "tldrText" | "tldrCorners" | "tldrFontSize" | "tldrFont">;
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
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [draft, setDraft] = useState<Article>(r.article);
  const dirty = setOf(draft) !== setOf(r.article);
  const saving = fetcher.state !== "idle";
  const ready = r.status === "READY FOR MERCHANT APPROVAL";
  const val = (e: Event) => (e.currentTarget as unknown as { value: string }).value;
  const articleUrl = sent?.url ?? null;
  const copy = (text: string) => {
    const hasToken = text.includes("{{ARTICLE_URL}}");
    const out = articleUrl ? text.replaceAll("{{ARTICLE_URL}}", articleUrl) : text;
    void navigator.clipboard?.writeText(out);
    try {
      (window as unknown as { shopify?: { toast?: { show: (m: string) => void } } }).shopify?.toast?.show(
        hasToken && !articleUrl ? "Copied. Send the article to Shopify first so the link can be filled in." : "Copied",
      );
    } catch {
      /* ignore */
    }
  };
  const img = draft.featured_image;
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

      <s-section>
        <s-stack direction="inline" gap="small">
          <s-button variant={tab === "edit" ? "primary" : "secondary"} onClick={() => setTab("edit")}>Edit</s-button>
          <s-button variant={tab === "preview" ? "primary" : "secondary"} onClick={() => setTab("preview")}>Preview</s-button>
        </s-stack>
      </s-section>

      {tab === "edit" ? (
      <>
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

      <s-section heading="Excerpt">
        <s-stack direction="block" gap="small">
          <s-text-area
            label="Excerpt (shown on your blog's listing page)"
            rows={3}
            value={draft.excerpt ?? ""}
            onInput={(e) => set("excerpt", val(e as unknown as Event))}
          />
          <s-text color="subdued">Shown on your blog's listing page. This is separate from the search description below.</s-text>
        </s-stack>
      </s-section>

      <s-section heading="Search engine listing">
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
          <s-text color="subdued">
            {articleUrl
              ? "The link to your article is filled in when you copy."
              : "The article link is filled in when you copy, once the article has been sent to Shopify."}
          </s-text>
          <s-text-field
            label="Email subject"
            value={draft.email_subject ?? ""}
            onInput={(e) => set("email_subject", val(e as unknown as Event))}
          />
          <s-stack direction="inline">
            <s-button onClick={() => copy(draft.email_subject ?? "")}>Copy subject</s-button>
          </s-stack>
          <s-text-area
            label="Email body"
            rows={8}
            value={draft.email_body ?? ""}
            onInput={(e) => set("email_body", val(e as unknown as Event))}
          />
          <s-stack direction="inline">
            <s-button onClick={() => copy(draft.email_body ?? "")}>Copy email body</s-button>
          </s-stack>
          <s-text-area
            label="Social post"
            rows={4}
            value={draft.social_post ?? ""}
            onInput={(e) => set("social_post", val(e as unknown as Event))}
          />
          <s-stack direction="inline">
            <s-button onClick={() => copy(draft.social_post ?? "")}>Copy social post</s-button>
          </s-stack>
        </s-stack>
      </s-section>
      </>
      ) : (
      <>
      <s-section heading="Preview">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            An approximate preview with neutral styling. Your theme controls fonts and spacing on your store. For the
            exact look, send it as a draft and use Preview in Shopify.
          </s-text>
          <div style={{ background: "#fff", border: "1px solid #e3e3e3", borderRadius: 12, padding: "32px 24px" }}>
            <div style={{ maxWidth: 720, margin: "0 auto", lineHeight: 1.65 }}>
              {img?.url ? (
                <img src={img.url} alt={img.alt} style={{ width: "100%", maxHeight: 380, objectFit: "cover", borderRadius: 8, marginBottom: 24 }} />
              ) : null}
              <h1 style={{ fontSize: 32, lineHeight: 1.2, margin: "0 0 8px" }}>{draft.h1}</h1>
              <p style={{ margin: "0 0 24px", color: "#6a6a6a", fontSize: 14 }}>
                {author ? `By ${author} · ` : ""}{new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
              </p>
              <div dangerouslySetInnerHTML={{ __html: buildBodyHtml(draft, handle, toc, tldrStyle) }} />
            </div>
          </div>
        </s-stack>
      </s-section>

      </>
      )}

      {r.edited && !dirty ? (
        <s-banner tone="info" heading="Your edits are saved">
          We re-run our format checks after you save, but we don't fact-check your own changes.
        </s-banner>
      ) : null}

      <s-section slot="aside" heading="Send to your Shopify blog">
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
            {!img?.url ? <s-text color="subdued">Reminder: this article has no featured image yet (see "Featured image" below).</s-text> : null}
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading="Featured image">
        <s-stack direction="block" gap="base">
          {!img?.url ? (
            <s-banner tone="warning" heading="This article has no featured image yet">
              Articles with a picture look better on your blog and when shared. Choose one below, or add one in Shopify
              after sending.
            </s-banner>
          ) : null}
          {images.length ? (
            <s-stack direction="block" gap="small">
              <s-text><strong>Choose from this product's photos</strong></s-text>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {images.map((im) => (
                  <button
                    key={im.url}
                    type="button"
                    onClick={() => set("featured_image", { url: im.url, alt: img?.url === im.url ? img.alt : im.alt || productTitle })}
                    style={{
                      padding: 2,
                      border: img?.url === im.url ? "3px solid #1a1a1a" : "1px solid #c9c9c9",
                      borderRadius: 8,
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <img src={im.url} alt={im.alt || productTitle} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, display: "block" }} />
                  </button>
                ))}
              </div>
            </s-stack>
          ) : null}
          <s-text-field
            label="Or paste an image address"
            details="A web address that starts with https://. To upload your own picture, add it in Shopify after sending."
            value={img?.url ?? ""}
            onInput={(e) => {
              const url = val(e as unknown as Event);
              set("featured_image", url ? { url, alt: img?.alt ?? "" } : undefined);
            }}
          />
          {img?.url ? (
            <s-stack direction="block" gap="small">
              <img src={img.url} alt="" style={{ maxWidth: 320, maxHeight: 200, borderRadius: 8, objectFit: "cover" }} />
              <s-text-field
                label="Image description (alt text)"
                details="Describes the picture for people using screen readers, and helps search engines."
                value={img.alt}
                onInput={(e) => set("featured_image", { url: img.url, alt: val(e as unknown as Event) })}
              />
              <s-stack direction="inline">
                <s-button onClick={() => set("featured_image", undefined)}>Remove image</s-button>
              </s-stack>
            </s-stack>
          ) : null}
          {draft.image_prompts?.[0] ? (
            <s-text color="subdued"><strong>Need a new picture?</strong> Idea: {draft.image_prompts[0]}</s-text>
          ) : null}
        </s-stack>
      </s-section>

    </s-page>
  );
}

export default function ArticlePage() {
  const { article, handle, productTitle, publishMode, store, images, tldrStyle, toc, author } = useLoaderData<typeof loader>();
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
  return <ArticleReview key={JSON.stringify(r)} r={r} back={back} productTitle={productTitle} url={url} publishMode={publishMode} store={store} images={images} tldrStyle={tldrStyle} toc={toc} author={author} handle={handle} />;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
