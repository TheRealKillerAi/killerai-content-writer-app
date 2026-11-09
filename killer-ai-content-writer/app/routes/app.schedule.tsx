import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadEffectiveSettings } from "../lib/settings.server";
import { effectiveZone, processDue, runInBackground, shopInfo, topUpSchedule } from "../lib/schedule.server";
import { listAuthors } from "../lib/authors.server";
import { pickedImage } from "../lib/files.server";
import { productImages } from "../lib/products.server";
import { useFilePicker } from "../components/useFilePicker";
import type { Angle } from "../lib/pipeline/types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await loadEffectiveSettings(admin, session.shop);
  const info = await shopInfo(admin);
  const tz = effectiveZone(settings, info.tz);
  const since = new Date(Date.now() - 7 * 86400000);
  const [rows, authors] = await Promise.all([
    db.scheduledPost.findMany({ where: { shop: session.shop, publishAt: { gte: since } }, orderBy: { publishAt: "asc" }, take: 60 }),
    listAuthors(session.shop),
  ]);
  const names = new Map(authors.map((a: { id: string; name: string }) => [a.id, a.name]));
  return {
    enabled: settings.scheduleEnabled,
    publishMode: settings.publishMode,
    tz,
    days: settings.scheduleDays,
    time: settings.scheduleTime,
    posts: rows.map((r: { id: string; publishAt: Date; angle: string; productId: string; productTitle: string; imageUrl: string; imageAlt: string; status: string; note: string | null; authorId: string; articleId: string | null }) => ({
      id: r.id,
      publishAt: r.publishAt.toISOString(),
      title: (JSON.parse(r.angle) as Angle).working_title,
      productId: r.productId,
      productTitle: r.productTitle,
      imageUrl: r.imageUrl,
      imageAlt: r.imageAlt,
      status: r.status,
      note: r.note,
      articleId: r.articleId,
      author: (names.get(r.authorId) as string | undefined) ?? settings.businessName,
    })),
  };
};

type Result = { image?: { url: string; alt: string }; error?: string; message?: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<Result> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");
  const id = String(form.get("id") ?? "");
  const own = id ? await db.scheduledPost.findFirst({ where: { id, shop } }) : null;

  if (intent === "file-url") {
    try {
      return { image: await pickedImage(admin, JSON.parse(String(form.get("ids")))) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "We couldn't use that picture." };
    }
  }
  if (intent === "set-image" && own) {
    const url = String(form.get("url") ?? "");
    await db.scheduledPost.update({ where: { id }, data: { imageUrl: /^https:\/\//.test(url) ? url : "", imageAlt: String(form.get("alt") ?? "").slice(0, 200) } });
  }
  if (intent === "product-image" && own) {
    const img = (await productImages(admin, `gid://shopify/Product/${own.productId}`))[0];
    await db.scheduledPost.update({ where: { id }, data: { imageUrl: img?.url ?? "", imageAlt: img?.alt || own.productTitle } });
  }
  if (intent === "delete" && own && own.status !== "writing") await db.scheduledPost.delete({ where: { id } });
  if (intent === "fill") {
    const settings = await loadEffectiveSettings(admin, shop);
    if (!settings.scheduleEnabled) return { error: "Switch on automatic articles in Settings first." };
    const tz = effectiveZone(settings, (await shopInfo(admin)).tz);
    runInBackground(topUpSchedule(shop, admin, settings, tz));
    return { message: "Finding topics. This takes a minute or so." };
  }
  if (intent === "write-now" && own && own.status === "scheduled") {
    const settings = await loadEffectiveSettings(admin, shop);
    runInBackground(processDue(shop, admin, settings, id));
    return { message: "Writing started. This takes about a minute." };
  }
  if (intent === "retry" && own && own.status === "failed") {
    await db.scheduledPost.update({ where: { id }, data: { status: "scheduled", note: null } });
    const settings = await loadEffectiveSettings(admin, shop);
    runInBackground(processDue(shop, admin, settings, id));
    return { message: "Trying again." };
  }
  return {};
};

const STATUS: Record<string, { label: string; tone: "info" | "success" | "critical" | "warning" | "neutral" }> = {
  scheduled: { label: "Topic scheduled", tone: "neutral" },
  writing: { label: "Writing now", tone: "info" },
  sent: { label: "Ready in Shopify", tone: "success" },
  failed: { label: "Needs a look", tone: "critical" },
};

function Row({ p, tz, live }: { p: ReturnType<typeof useLoaderData<typeof loader>>["posts"][number]; tz: string; live: boolean }) {
  const f = useFetcher<Result>();
  const pick = useFilePicker((img) => f.submit({ intent: "set-image", id: p.id, url: img.url, alt: img.alt || p.productTitle }, { method: "POST" }));
  const editable = p.status === "scheduled";
  const when = new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(p.publishAt));
  const st = STATUS[p.status] ?? STATUS.scheduled;
  return (
    <s-table-row>
      <s-table-cell>{when}</s-table-cell>
      <s-table-cell>
        <s-stack direction="inline" gap="small" alignItems="center">
          {p.imageUrl ? <s-thumbnail src={p.imageUrl} alt={p.imageAlt || p.title} size="small" /> : <s-text color="subdued">No image</s-text>}
          {editable ? (
            <s-stack direction="inline" gap="none">
              <s-button variant="tertiary" onClick={pick.pick}>{p.imageUrl ? "Change" : "Add"}</s-button>
              <s-button variant="tertiary" onClick={() => f.submit({ intent: "product-image", id: p.id }, { method: "POST" })}>Product photo</s-button>
              {p.imageUrl ? <s-button variant="tertiary" onClick={() => f.submit({ intent: "set-image", id: p.id, url: "" }, { method: "POST" })}>Remove</s-button> : null}
            </s-stack>
          ) : null}
        </s-stack>
        {pick.error ? <s-text color="subdued">{pick.error}</s-text> : null}
      </s-table-cell>
      <s-table-cell>
        <s-stack direction="block" gap="none">
          {p.articleId ? <s-link href={`/app/article/${p.articleId}`}>{p.title}</s-link> : <s-text>{p.title}</s-text>}
          <s-text color="subdued">{p.productTitle} · by {p.author}</s-text>
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-stack direction="block" gap="none">
          <s-badge tone={st.tone}>{p.status === "sent" ? (live ? "Scheduled in Shopify" : "Draft in Shopify") : st.label}</s-badge>
          {p.note ? <s-text color="subdued">{p.note}</s-text> : null}
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-stack direction="inline" gap="none">
          {p.status === "scheduled" ? <s-button variant="tertiary" onClick={() => f.submit({ intent: "write-now", id: p.id }, { method: "POST" })}>Write now</s-button> : null}
          {p.status === "failed" ? <s-button variant="tertiary" onClick={() => f.submit({ intent: "retry", id: p.id }, { method: "POST" })}>Try again</s-button> : null}
          {p.status !== "writing" ? <s-button variant="tertiary" tone="critical" onClick={() => f.submit({ intent: "delete", id: p.id }, { method: "POST" })}>Remove</s-button> : null}
        </s-stack>
      </s-table-cell>
    </s-table-row>
  );
}

export default function Schedule() {
  const { enabled, publishMode, tz, posts, days, time } = useLoaderData<typeof loader>();
  const fill = useFetcher<Result>();
  const rv = useRevalidator();
  const [waitUntilMs, setWaitUntilMs] = useState(0);
  const busy = posts.some((p) => p.status === "writing") || Date.now() < waitUntilMs;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => rv.revalidate(), 6000);
    return () => clearInterval(t);
  }, [busy, rv]);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const summary = days.split(",").map((d) => dayNames[Number(d)]).join(", ");

  return (
    <s-page heading="Schedule">
      <s-button
        slot="primary-action"
        variant="primary"
        {...(fill.state !== "idle" ? { loading: true } : {})}
        onClick={() => {
          fill.submit({ intent: "fill" }, { method: "POST" });
          setWaitUntilMs(Date.now() + 90000);
        }}
      >
        Find topics now
      </s-button>
      {!enabled ? (
        <s-banner tone="warning" heading="Automatic articles are off">
          <s-paragraph>Turn them on in Settings, then choose your days and time.</s-paragraph>
          <s-button href="/app/settings">Open Settings</s-button>
        </s-banner>
      ) : (
        <s-banner tone="info">
          {summary} at {time} ({tz.replace(/_/g, " ")}). {publishMode === "live" ? "Articles go live automatically." : "Articles are saved as drafts."} Topics are lined up a week ahead and each article is written about a day before it goes out.
        </s-banner>
      )}
      {fill.data?.error ? <s-banner tone="critical">{fill.data.error}</s-banner> : null}
      {fill.data?.message ? <s-banner tone="success">{fill.data.message}</s-banner> : null}
      <s-section padding="none">
        {posts.length === 0 ? (
          <s-box padding="large">
            <s-paragraph>
              Nothing is scheduled yet. {enabled ? 'Press "Find topics now", or wait for tonight\'s automatic run.' : "Turn on automatic articles in Settings to get started."}
            </s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Publishes</s-table-header>
              <s-table-header>Image</s-table-header>
              <s-table-header>Article</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header />
            </s-table-header-row>
            <s-table-body>
              {posts.map((p) => (
                <Row key={p.id} p={p} tz={tz} live={publishMode === "live"} />
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
