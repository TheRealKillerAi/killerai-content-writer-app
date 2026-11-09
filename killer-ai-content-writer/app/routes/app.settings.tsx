import { useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadEffectiveSettings, saveSettings, settingsFromForm } from "../lib/settings.server";
import { listAuthors } from "../lib/authors.server";
import { listBlogs, recentArticleTexts } from "../lib/products.server";
import { chatJson, LlmError } from "../lib/pipeline/llm.server";
import { contrastRatio, tldrBoxStyle, type TldrStyle } from "../lib/tldr";
import learnVoicePrompt from "../lib/pipeline/prompts/learn-voice.md?raw";

const TABS = [
  { id: "brand", label: "Brand and voice", blurb: "How your articles sound, and what you sell." },
  { id: "writing", label: "Writing", blurb: "Language, length and the summary box." },
  { id: "publish", label: "Publish settings", blurb: "Where articles go and how." },
  { id: "advanced", label: "Advanced", blurb: "Schema, templates and custom instructions." },
  { id: "plan", label: "Your plan", blurb: "Plan limits and usage." },
] as const;
type TabId = (typeof TABS)[number]["id"];

type ActionResult = { intent: "save" | "learn"; ok: boolean; message?: string; voice?: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [settings, blogs, authors] = await Promise.all([
    loadEffectiveSettings(admin, session.shop),
    listBlogs(admin),
    listAuthors(session.shop),
  ]);
  return { settings, blogs, authors: authors.map((a) => ({ id: a.id, name: a.name, kind: a.kind })) };
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
  const { settings: s, blogs, authors } = useLoaderData<typeof loader>();
  const saveF = useFetcher<ActionResult>();
  const learnF = useFetcher<ActionResult>();
  const [resetKey, setResetKey] = useState(0);
  const [tab, setTab] = useState<TabId>("brand");
  const voiceRef = useRef<HTMLElement & { value: string }>(null);
  const [pv, setPv] = useState<TldrStyle>({
    tldrEnabled: s.tldrEnabled,
    tldrLabel: s.tldrLabel,
    tldrBg: s.tldrBg,
    tldrText: s.tldrText,
    tldrCorners: s.tldrCorners,
    tldrFontSize: s.tldrFontSize,
    tldrFont: s.tldrFont,
  });
  const setP = (patch: Partial<TldrStyle>) => setPv((p) => ({ ...p, ...patch }));
  const val = (e: Event) => (e.currentTarget as unknown as { value: string }).value;
  const lowContrast = contrastRatio(pv.tldrBg, pv.tldrText) < 4.5;

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
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
          <nav aria-label="Settings sections" style={{ flex: "0 0 220px", minWidth: 180, display: "flex", flexDirection: "column", gap: 2 }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                style={{
                  textAlign: "left",
                  padding: "8px 12px",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  font: "inherit",
                  fontWeight: tab === t.id ? 650 : 450,
                  background: tab === t.id ? "rgba(0,0,0,0.07)" : "transparent",
                  color: "inherit",
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div style={{ flex: "1 1 420px", minWidth: 0 }}>
        <div hidden={tab !== "brand"}>
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
            <s-text-field
              name="businessName"
              label="Business name"
              details="Filled in from your Shopify store name. Change it if you trade under a different name."
              value={s.businessName}
            />
            <s-text-area name="whatYouSell" label="What you sell" rows={2} value={s.whatYouSell} />
            <s-text-area name="audience" label="Who your customers are" rows={2} value={s.audience} />
          </s-stack>
        </s-section>

        </div>
        <div hidden={tab !== "writing"}>
        <s-section heading="Writing">
          <s-stack direction="block" gap="base">
            <s-select name="language" label="Language" value={s.language} details="British and American English are coming soon.">
              <s-option value="en-AU">English (Australia)</s-option>
            </s-select>
            <s-select
              name="maxWords"
              label="Article length"
              value={s.maxWords ? String(s.maxWords) : "auto"}
              details="Articles are never padded. Short product facts mean a shorter article, whatever you choose."
            >
              <s-option value="auto">Let the facts decide (recommended)</s-option>
              <s-option value="600">Up to 600 words</s-option>
              <s-option value="1000">Up to 1,000 words</s-option>
              <s-option value="1500">Up to 1,500 words</s-option>
            </s-select>
          </s-stack>
        </s-section>

        <s-section heading="TL;DR summary box">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              A short summary at the top of each article. Your theme doesn't style this, so choose how it looks here.
            </s-paragraph>
            <s-checkbox
              name="tldrEnabled"
              label="Include a TL;DR box at the top of articles"
              checked={s.tldrEnabled}
              onChange={(e) => setP({ tldrEnabled: (e.currentTarget as unknown as { checked: boolean }).checked })}
            />
            <s-text-field
              name="tldrLabel"
              label="Label"
              details='For example "TL;DR", "In short" or "Quick summary".'
              value={s.tldrLabel}
              onInput={(e) => setP({ tldrLabel: val(e as unknown as Event) })}
            />
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
              <s-color-field
                name="tldrBg"
                label="Background colour"
                value={s.tldrBg}
                onInput={(e) => setP({ tldrBg: val(e as unknown as Event) })}
                onChange={(e) => setP({ tldrBg: val(e as unknown as Event) })}
              />
              <s-color-field
                name="tldrText"
                label="Text colour"
                value={s.tldrText}
                onInput={(e) => setP({ tldrText: val(e as unknown as Event) })}
                onChange={(e) => setP({ tldrText: val(e as unknown as Event) })}
              />
            </s-grid>
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
              <s-select
                name="tldrCorners"
                label="Corners"
                value={s.tldrCorners}
                onChange={(e) => setP({ tldrCorners: val(e as unknown as Event) as TldrStyle["tldrCorners"] })}
              >
                <s-option value="rounded">Rounded</s-option>
                <s-option value="square">Square</s-option>
              </s-select>
              <s-number-field
                name="tldrFontSize"
                label="Font size (px)"
                details="Between 10 and 48. Most themes use about 16."
                min={10}
                max={48}
                step={1}
                value={String(s.tldrFontSize)}
                onInput={(e) => setP({ tldrFontSize: Number(val(e as unknown as Event)) || 16 })}
                onChange={(e) => setP({ tldrFontSize: Number(val(e as unknown as Event)) || 16 })}
              />
              <s-select
                name="tldrFont"
                label="Font"
                value={s.tldrFont}
                onChange={(e) => setP({ tldrFont: val(e as unknown as Event) as TldrStyle["tldrFont"] })}
              >
                <s-option value="theme">Match my theme</s-option>
                <s-option value="sans">Sans-serif</s-option>
                <s-option value="serif">Serif</s-option>
                <s-option value="mono">Monospace</s-option>
              </s-select>
            </s-grid>
            {lowContrast ? (
              <s-banner tone="warning">
                These colours may be hard to read. Try a bigger difference between the background and the text.
              </s-banner>
            ) : null}
            {pv.tldrEnabled ? (
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">Preview</s-text>
                  <div style={Object.fromEntries(tldrBoxStyle(pv).split(";").filter(Boolean).map((d) => {
                    const i = d.indexOf(":");
                    const k = d.slice(0, i).trim().replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
                    return [k, d.slice(i + 1).trim()];
                  }))}>
                    <p style={{ margin: 0, color: "inherit" }}>
                      <strong>{(pv.tldrLabel || "TL;DR").trim()}:</strong> One ball cleans a 4 kg wash without added
                      detergent, and it can be recharged in sunlight.
                    </p>
                  </div>
                </s-stack>
              </s-box>
            ) : null}
          </s-stack>
        </s-section>

        </div>
        <div hidden={tab !== "publish"}>
        <s-section heading="Publishing">
          <s-stack direction="block" gap="base">
            <s-select name="blogId" label="Publish to blog" value={s.blogId.startsWith("gid://") ? s.blogId : "default"} details="Where finished articles are sent in your Shopify store.">
              <s-option value="default">Your store's main blog</s-option>
              {blogs.map((b) => (
                <s-option key={b.id} value={b.id}>{b.title}</s-option>
              ))}
            </s-select>
            <s-select
              name="defaultAuthorId"
              label="Default author"
              value={s.defaultAuthorId}
              details="Used for new articles. If none is chosen, your business name is used."
            >
              <s-option value="">No author (use my business name)</s-option>
              {authors.map((a) => (
                <s-option key={a.id} value={a.id}>
                  {a.name}
                  {a.kind === "persona" ? " (persona)" : ""}
                </s-option>
              ))}
            </s-select>
            <s-stack direction="inline">
              <s-button href="/app/authors">{authors.length ? "Manage authors" : "Add an author"}</s-button>
            </s-stack>
            <s-checkbox
              name="authorBox"
              label='Add an "About the author" box at the end of articles'
              details="Shows the default author's name, title and bio. Only works once you've added an author with a bio."
              checked={s.authorBox}
            />
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

        </div>
        <div hidden={tab !== "advanced"}>
        <s-section heading="Advanced">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Most stores can leave these alone. Several take effect when publishing to your blog is released.
            </s-paragraph>
            <s-checkbox name="toc" label="Add a table of contents" checked={s.toc} />
            <s-banner tone="warning" heading="Check before turning on any schema option">
              Your theme, or another app (such as an SEO app), may already add article, FAQ or breadcrumb schema to
              your blog posts. Adding it twice can confuse search engines. To check, paste the address of an existing
              blog post into Google's Rich Results Test. If it already shows Article, FAQ or Breadcrumb results, leave
              that option off.
            </s-banner>
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
              details="Style, structure or focus only, for example how to word disposal advice. These take priority over our default style rules. Our fact-checking rules always apply and can't be turned off. See Help for examples."
              rows={3}
              value={s.customContentPrompt}
            />
            <s-text-area
              name="customEmailPrompt"
              label="Extra instructions for the email"
              details="How the email should sound and look: tone, length, whether to open with a greeting, emoji or no emoji, and so on. Our fact-checking rules always apply."
              rows={3}
              value={s.customEmailPrompt}
            />
          </s-stack>
        </s-section>

        </div>
        <div hidden={tab !== "plan"}>
        <s-section heading="Your plan">
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-text><strong>Free plan</strong></s-text>
              <s-badge>Placeholder</s-badge>
            </s-stack>
            <s-text color="subdued">Plan limits and usage will show here.</s-text>
            <s-stack direction="inline">
              <s-button href="/app/plans">Upgrade plan</s-button>
            </s-stack>
          </s-stack>
        </s-section>
        </div>
          </div>
        </div>
      </s-page>
    </form>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
