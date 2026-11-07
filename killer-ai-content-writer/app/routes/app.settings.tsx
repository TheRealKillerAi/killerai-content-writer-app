import { useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadSettings, saveSettings, settingsFromForm } from "../lib/settings.server";
import { listBlogs, recentArticleTexts } from "../lib/products.server";
import { chatJson, LlmError } from "../lib/pipeline/llm.server";
import learnVoicePrompt from "../lib/pipeline/prompts/learn-voice.md?raw";

type ActionResult = { intent: "save" | "learn"; ok: boolean; message?: string; voice?: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [settings, blogs] = await Promise.all([loadSettings(session.shop), listBlogs(admin)]);
  return { settings, blogs };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "learn") {
    const texts = await recentArticleTexts(admin);
    if (!texts.length) {
      return {
        intent: "learn",
        ok: false,
        message: "We couldn't find any published blog posts on your store to learn from. Describe your voice in your own words instead.",
      };
    }
    try {
      const { json } = await chatJson<{ voice?: string }>(
        learnVoicePrompt,
        texts.map((t, i) => `--- POST ${i + 1}\n${t}`).join("\n\n"),
        { temperature: 0.2 },
      );
      return { intent: "learn", ok: !!json.voice, voice: json.voice ?? "" };
    } catch (e) {
      return { intent: "learn", ok: false, message: e instanceof LlmError ? e.message : "Something went wrong. Please try again." };
    }
  }
  await saveSettings(session.shop, settingsFromForm(form));
  return { intent: "save", ok: true };
};

const toast = (msg: string) => {
  try {
    (window as unknown as { shopify?: { toast?: { show: (m: string) => void } } }).shopify?.toast?.show(msg);
  } catch {
    /* ignore */
  }
};

export default function Settings() {
  const { settings: s, blogs } = useLoaderData<typeof loader>();
  const saveF = useFetcher<ActionResult>();
  const learnF = useFetcher<ActionResult>();
  const [resetKey, setResetKey] = useState(0);
  const voiceRef = useRef<HTMLElement & { value: string }>(null);

  const learned = learnF.data?.intent === "learn" ? learnF.data : null;

  const applyLearned = () => {
    const el = voiceRef.current;
    if (!el || !learned?.voice) return;
    el.value = learned.voice;
    // Make the save bar notice the programmatic change.
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  return (
    <form
      key={resetKey + ":" + JSON.stringify(s)}
      data-save-bar
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("intent", "save");
        saveF.submit(fd, { method: "POST" });
        toast("Settings saved");
      }}
      onReset={() => setResetKey((k) => k + 1)}
    >
      <s-page heading="Settings">
        <s-section heading="Brand voice">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              This is how your articles sound. The more specific you are, the less editing you'll do.
            </s-paragraph>
            <s-text-area
              ref={voiceRef as never}
              name="brandDescription"
              label="Describe your brand's voice"
              details="For example: friendly and plain-spoken, short sentences, honest about trade-offs, never pushy."
              rows={6}
              value={s.brandDescription}
            />
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-button
                {...(learnF.state !== "idle" ? { loading: true } : {})}
                onClick={() => learnF.submit({ intent: "learn" }, { method: "POST" })}
              >
                Learn my voice from my blog
              </s-button>
              <s-text color="subdued">Reads your recent blog posts and suggests a description. Nothing changes until you save.</s-text>
            </s-stack>
            {learned && learned.ok && learned.voice ? (
              <s-banner tone="success" heading="Here's what we picked up from your blog">
                <s-paragraph>{learned.voice}</s-paragraph>
                <s-stack direction="inline">
                  <s-button onClick={applyLearned}>Use this description</s-button>
                </s-stack>
              </s-banner>
            ) : null}
            {learned && !learned.ok ? <s-banner tone="warning">{learned.message ?? "We couldn't learn your voice this time."}</s-banner> : null}
            <s-text-field name="wordsToUse" label="Words and phrases you like to use" value={s.wordsToUse} />
            <s-text-field name="wordsToAvoid" label="Words and phrases to avoid" value={s.wordsToAvoid} />
            <s-text-area
              name="neverMention"
              label="Never mention"
              details="Competitors, claims or topics to always leave out. One per line."
              rows={3}
              value={s.neverMention}
            />
          </s-stack>
        </s-section>

        <s-section heading="About your store">
          <s-stack direction="block" gap="base">
            <s-paragraph>Context that helps us pitch articles correctly. We never treat this as a source of product facts.</s-paragraph>
            <s-text-field name="businessName" label="Business name" value={s.businessName} />
            <s-text-area name="whatYouSell" label="What you sell" rows={2} value={s.whatYouSell} />
            <s-text-area name="audience" label="Who your customers are" rows={2} value={s.audience} />
          </s-stack>
        </s-section>

        <s-section heading="Writing">
          <s-stack direction="block" gap="base">
            <s-select name="language" label="Language" value={s.language} details="British and American English are coming soon.">
              <s-option value="en-AU">English (Australia)</s-option>
            </s-select>
            <s-select
              name="maxWords"
              label="Article length"
              value={s.maxWords ? String(s.maxWords) : ""}
              details="Articles are never padded. Short product facts mean a shorter article, whatever you choose."
            >
              <s-option value="">Let the facts decide (recommended)</s-option>
              <s-option value="600">Up to 600 words</s-option>
              <s-option value="1000">Up to 1,000 words</s-option>
              <s-option value="1500">Up to 1,500 words</s-option>
            </s-select>
          </s-stack>
        </s-section>

        <s-section heading="Publishing">
          <s-stack direction="block" gap="base">
            <s-select name="blogId" label="Publish to blog" value={s.blogId} details="Where finished articles are sent in your Shopify store.">
              <s-option value="">Your store's main blog</s-option>
              {blogs.map((b) => (
                <s-option key={b.id} value={b.id}>{b.title}</s-option>
              ))}
            </s-select>
            <s-text-field name="defaultAuthor" label="Default author" value={s.defaultAuthor} />
            <s-select
              name="publishMode"
              label="When an article is sent to Shopify"
              value={s.publishMode}
              details="Draft is safest: nothing goes live until you publish it yourself."
            >
              <s-option value="draft">Save as a draft (recommended)</s-option>
              <s-option value="live">Publish straight away</s-option>
            </s-select>
            <s-checkbox name="keywordsAsTags" label="Add the target keywords as article tags" checked={s.keywordsAsTags} />
            <s-checkbox
              name="linkToOtherArticles"
              label="Link to your other articles from new ones"
              details="Good for SEO. Coming soon: this takes effect once the feature is released."
              checked={s.linkToOtherArticles}
            />
          </s-stack>
        </s-section>

        <s-section heading="Advanced">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Most stores can leave these alone. Several take effect when publishing to your blog is released.
            </s-paragraph>
            <s-checkbox name="toc" label="Add a table of contents" checked={s.toc} />
            <s-checkbox
              name="articleSchema"
              label="Add article schema"
              details="Many themes already add this. Turning it on could duplicate it, so check your theme first."
              checked={s.articleSchema}
            />
            <s-checkbox
              name="faqSchema"
              label="Add FAQ schema"
              details="Mostly useful to AI answer engines. Google now shows FAQ rich results for few sites."
              checked={s.faqSchema}
            />
            <s-checkbox
              name="breadcrumbSchema"
              label="Add breadcrumb schema"
              details="Many themes already add this."
              checked={s.breadcrumbSchema}
            />
            <s-text-field
              name="articleTemplate"
              label="Article theme template"
              details="Only if your theme has a custom article template. Must match its name exactly. Leave empty to use the default."
              value={s.articleTemplate}
            />
            <s-text-area
              name="customIdeasPrompt"
              label="Extra instructions for article ideas"
              details="Style or focus only. For example: favour how-to topics."
              rows={3}
              value={s.customIdeasPrompt}
            />
            <s-text-area
              name="customContentPrompt"
              label="Extra instructions for writing"
              details="Style or focus only. Our fact-checking rules always apply and can't be turned off."
              rows={3}
              value={s.customContentPrompt}
            />
          </s-stack>
        </s-section>

        <s-section heading="Your plan">
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-text><strong>Free plan</strong></s-text>
              <s-badge>Placeholder</s-badge>
            </s-stack>
            <s-text color="subdued">Plan limits and usage will show here.</s-text>
            <s-stack direction="inline">
              <s-button onClick={() => toast("Plans are coming soon")}>Upgrade plan</s-button>
            </s-stack>
          </s-stack>
        </s-section>
      </s-page>
    </form>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
