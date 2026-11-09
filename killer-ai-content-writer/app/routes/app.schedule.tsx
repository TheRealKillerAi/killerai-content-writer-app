import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { UsageMeter } from "../components/UsageMeter";
import { monthlyUsage } from "../lib/usage.server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadEffectiveSettings } from "../lib/settings.server";
import { effectiveZone, fillChain, isWorking, openSlotCount, processDue, runInBackground, sendTopicsEmail, shopInfo } from "../lib/schedule.server";
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
  const status = await db.scheduleStatus.findUnique({ where: { shop: session.shop } });
  return {
    note: status?.note ?? "",
    working: await isWorking(session.shop),
    usage: await monthlyUsage(session.shop),
    enabled: settings.scheduleEnabled,
    planDays: settings.planDays,
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
    const open = await openSlotCount(shop, settings, tz);
    if (open > 0) {
      runInBackground(fillChain(shop, admin, settings, tz, { force: true }));
      return { message: `Finding topics for ${open} open day${open === 1 ? "" : "s"}. You can leave this page and come back later. We'll email you the topics when they're ready.` };
    }
    const d = await sendTopicsEmail(shop, admin, settings, tz);
    const upcoming = `Your next ${settings.planDays} days are already lined up, so there's nothing new to find. More are added automatically as the days pass.`;
    if (d.status === "sent") return { message: `${upcoming} We've emailed ${d.count} topic${d.count === 1 ? "" : "s"} to ${d.to}.` };
    if (d.status === "failed") return { error: `${upcoming} We couldn't send the email to ${d.to || "your store address"}. Please try again in a minute.` };
    if (d.status === "off") return { message: `${upcoming} Topic emails are switched off in Settings.` };
    return { message: `${upcoming} The topics have already been emailed.` };
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

const ICONS = {
  image: "M4 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm2 0v6.6l2.3-2.3a1 1 0 0 1 1.4 0l1.8 1.8 1.2-1.2a1 1 0 0 1 1.4 0L14 11.4V5H6Zm3 2.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
  product: "M10 2 3 5.5v5C3 14.4 6 17.3 10 18c4-.7 7-3.6 7-7.5v-5L10 2Zm0 2.2 5 2.5v3.8c0 2.7-2 4.9-5 5.6-3-.7-5-2.9-5-5.6V6.7l5-2.5Z",
  trash: "M8 2h4l1 1h3v2H4V3h3l1-1Zm-3 5h10l-.7 9a1 1 0 0 1-1 1H6.7a1 1 0 0 1-1-1L5 7Z",
};

function IconBtn({ label, onClick, path }: { label: string; onClick: () => void; path: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      style={{ width: 28, height: 28, display: "grid", placeItems: "center", border: "1px solid rgba(0,0,0,0.18)", borderRadius: 8, background: "#fff", cursor: "pointer", padding: 0 }}
    >
      <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d={path} /></svg>
    </button>
  );
}

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
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
          {editable ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <IconBtn label={p.imageUrl ? "Change image" : "Add image"} onClick={pick.pick} path={ICONS.image} />
              <IconBtn label="Use the product photo" onClick={() => f.submit({ intent: "product-image", id: p.id }, { method: "POST" })} path={ICONS.product} />
            </div>
          ) : null}
          {p.imageUrl ? (
            <div className="ka-thumb" style={{ position: "relative", width: 64, height: 64 }}>
              <img src={p.imageUrl} alt={p.imageAlt || p.title} width={64} height={64} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)", display: "block" }} />
              {editable ? (
                <button
                  type="button"
                  className="ka-thumb-x"
                  title="Remove image"
                  aria-label="Remove image"
                  onClick={() => f.submit({ intent: "set-image", id: p.id, url: "" }, { method: "POST" })}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                </button>
              ) : null}
            </div>
          ) : (
            <div style={{ width: 64, height: 64, borderRadius: 8, border: "1px dashed rgba(0,0,0,0.25)", display: "grid", placeItems: "center", fontSize: 11, opacity: 0.6 }}>No image</div>
          )}
        </div>
        {pick.error ? <div style={{ fontSize: 12, opacity: 0.7, maxWidth: 160 }}>{pick.error}</div> : null}
      </s-table-cell>
      <s-table-cell>
        <div style={{ minWidth: 220, maxWidth: 460, whiteSpace: "normal", overflowWrap: "anywhere" }}>
          {p.articleId ? <s-link href={`/app/article/${p.articleId}`}>{p.title}</s-link> : <s-text>{p.title}</s-text>}
          <div style={{ opacity: 0.7, fontSize: 13, marginTop: 2 }}>{p.productTitle} · by {p.author}</div>
        </div>
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
  const { enabled, publishMode, tz, posts, days, time, usage, planDays, note, working } = useLoaderData<typeof loader>();
  const fill = useFetcher<Result>();
  const rv = useRevalidator();
  const [waitUntilMs, setWaitUntilMs] = useState(0);
  const busy = working || posts.some((p) => p.status === "writing") || Date.now() < waitUntilMs;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => rv.revalidate(), 6000);
    return () => clearInterval(t);
  }, [busy, rv]);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const summary = days.split(",").map((d) => dayNames[Number(d)]).join(", ");

  return (
    <s-page heading="Schedule">
      <style>{`
        .ka-thumb-x{position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;border:none;background:#d72c0d;color:#fff;display:grid;place-items:center;padding:0;cursor:pointer;opacity:0;transition:opacity .12s}
        .ka-thumb:hover .ka-thumb-x,.ka-thumb-x:focus-visible{opacity:1}
        @media (hover:none){.ka-thumb-x{opacity:1}}
      `}</style>
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
          {summary} at {time} ({tz.replace(/_/g, " ")}). {publishMode === "live" ? "Articles go live automatically." : "Articles are saved as drafts."} Topics are lined up {planDays} days ahead and each article is written about a day before it goes out.
        </s-banner>
      )}
      <s-section>
        <UsageMeter usage={usage} />
      </s-section>
      {working ? (
        <s-banner tone="info" heading="Still finding topics">
          This is taking longer than usual. We'll keep working, so you can leave this page and come back later. New topics appear here as they're found.
        </s-banner>
      ) : null}
      {note && !working ? <s-banner tone="warning" heading="Some days couldn't be filled">{note}</s-banner> : null}
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
