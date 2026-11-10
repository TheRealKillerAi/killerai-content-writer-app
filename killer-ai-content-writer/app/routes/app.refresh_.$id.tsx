import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { buildContext, isProtected, loadPost } from "../lib/refresh.server";
import { applyRefresh, refreshHistory, setProtected, undoRefresh, UNDO_DAYS } from "../lib/refreshStore.server";
import { proposeChanges, applyChanges } from "../lib/refreshChanges";
import { ageLabel, scoreExisting } from "../lib/refresh";
import { RulesPanel } from "../components/RulesPanel";
import { SeoBadge } from "../components/ArticleBadges";

const gidOf = (id: string) => `gid://shopify/Article/${id}`;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const post = await loadPost(admin, gidOf(params.id!));
  if (!post) return { missing: true as const };
  const { ctx, skippedChecks } = await buildContext(admin, session.shop, [post]);
  const { changes, notes } = proposeChanges(post, ctx);
  const months = Math.max(0, Math.round((Date.now() - new Date(post.updatedAt).getTime()) / (30.44 * 86400000)));
  return {
    missing: false as const,
    post,
    hosts: [...ctx.hosts],
    rules: ctx.rules!,
    changes,
    notes,
    skippedChecks,
    age: ageLabel(months),
    protectedPost: await isProtected(session.shop, post),
    history: await refreshHistory(session.shop, post.id),
    store: session.shop.replace(".myshopify.com", ""),
  };
};

type ActionResult = { intent: string; ok: boolean; message: string };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const gid = gidOf(params.id!);
  const by = (session as { email?: string | null }).email || session.shop;
  try {
    if (intent === "apply") {
      const list = (k: string) => String(form.get(k) ?? "").split(",").filter(Boolean);
      const r = await applyRefresh(admin, session.shop, gid, list("accepted"), list("ignored"), by);
      if (!r.ok) return { intent, ok: false, message: r.error };
      return { intent, ok: true, message: `Updated the post with ${r.applied} change${r.applied === 1 ? "" : "s"}.${r.skipped ? ` ${r.skipped} could not be applied because the post had changed.` : ""}` };
    }
    if (intent === "undo") {
      const r = await undoRefresh(admin, session.shop, String(form.get("runId")));
      return r.ok ? { intent, ok: true, message: "Undone. The post is back as it was." } : { intent, ok: false, message: r.error };
    }
    if (intent === "protect") {
      const post = await loadPost(admin, gid);
      if (!post) return { intent, ok: false, message: "We couldn't find this post." };
      const on = form.get("on") === "1";
      const blog = form.get("kind") === "blog";
      await setProtected(session.shop, blog ? "blog" : "post", blog ? post.blogHandle : post.id.split("/").pop()!, blog ? post.blogTitle : post.title, on);
      return { intent, ok: true, message: on ? "AI Refresh will leave it alone." : "AI Refresh can look at it again." };
    }
  } catch (e) {
    console.error("refresh action failed", e);
    return { intent, ok: false, message: "Something went wrong. Nothing was changed. Please try again." };
  }
  return { intent, ok: false, message: "Unknown action." };
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const diff = (a: number, b: number) => (b === a ? "no change" : `${b > a ? "+" : "−"}${Math.abs(b - a)}`);
const mark = (pass: boolean) => (pass ? "✓" : "✗");

type CheckRow = { id: string; label: string; pass: boolean };
function ChecksTable({ before, after }: { before: CheckRow[]; after: CheckRow[] }) {
  const afterById = new Map(after.map((c) => [c.id, c]));
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Check</s-table-header>
        <s-table-header>Before</s-table-header>
        <s-table-header>After</s-table-header>
        <s-table-header>{" "}</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {before.map((c) => {
          const a = afterById.get(c.id)?.pass ?? c.pass;
          return (
            <s-table-row key={c.id}>
              <s-table-cell>{c.label}</s-table-cell>
              <s-table-cell>{mark(c.pass)}</s-table-cell>
              <s-table-cell>{mark(a)}</s-table-cell>
              <s-table-cell>
                {a === c.pass ? null : a ? <s-badge tone="success">Now passes</s-badge> : <s-badge tone="critical">Now fails</s-badge>}
              </s-table-cell>
            </s-table-row>
          );
        })}
      </s-table-body>
    </s-table>
  );
}

export default function RefreshPost() {
  const data = useLoaderData<typeof loader>();
  const applyF = useFetcher<ActionResult>();
  const otherF = useFetcher<ActionResult>();
  const [decision, setDecision] = useState<Record<string, "accepted" | "ignored">>({});

  // Everything below needs the post; the hooks above must run first.
  const post = data.missing ? null : data.post;
  const changes = data.missing ? [] : data.changes;
  const acceptedList = changes.filter((c) => decision[c.id] === "accepted");

  const view = useMemo(() => {
    if (!post || data.missing) return null;
    const hosts = new Set(data.hosts);
    const next = applyChanges(post.body, acceptedList);
    return { before: scoreExisting(post, hosts), after: scoreExisting({ ...post, body: next.html }, hosts) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post, decision]);

  useEffect(() => {
    if (applyF.data?.intent === "apply" && applyF.data.ok) setDecision({});
    const d = applyF.data ?? otherF.data;
    if (d) (window as unknown as { shopify?: { toast?: { show: (m: string, o?: { isError?: boolean }) => void } } }).shopify?.toast?.show(d.message, { isError: !d.ok });
  }, [applyF.data, otherF.data]);

  if (data.missing || !post || !view) {
    return (
      <s-page heading="AI Refresh">
        <s-link slot="breadcrumb-actions" href="/app/refresh">AI Refresh</s-link>
        <s-section>
          <s-paragraph>We couldn't find that post. It may have been deleted.</s-paragraph>
        </s-section>
      </s-page>
    );
  }

  const busy = applyF.state !== "idle" || otherF.state !== "idle";
  const set = (ids: string[], d: "accepted" | "ignored") => setDecision((p) => ({ ...p, ...Object.fromEntries(ids.map((i) => [i, d])) }));
  const adminUrl = `https://admin.shopify.com/store/${data.store}/content/articles/${post.id.split("/").pop()}`;
  const ignoredIds = changes.filter((c) => decision[c.id] === "ignored").map((c) => c.id);
  const undecided = changes.filter((c) => !decision[c.id]).length;

  return (
    <s-page heading={post.title}>
      <s-link slot="breadcrumb-actions" href="/app/refresh">AI Refresh</s-link>
      <s-button slot="primary-action" variant="primary" {...(acceptedList.length === 0 ? { disabled: true } : {})} {...(applyF.state !== "idle" ? { loading: true } : {})}
        onClick={() => applyF.submit({ intent: "apply", accepted: acceptedList.map((c) => c.id).join(","), ignored: ignoredIds.join(",") }, { method: "POST" })}>
        {acceptedList.length ? `Update this post in Shopify (${acceptedList.length} change${acceptedList.length === 1 ? "" : "s"})` : "Update this post in Shopify"}
      </s-button>

      {data.protectedPost ? (
        <s-banner tone="warning" heading="This post is set to never be refreshed">
          <s-stack direction="block" gap="small">
            <s-paragraph>It doesn't appear in the AI Refresh list. You can still review it here.</s-paragraph>
            <s-button onClick={() => otherF.submit({ intent: "protect", kind: "post", on: "0" }, { method: "POST" })}>Allow refreshing again</s-button>
          </s-stack>
        </s-banner>
      ) : null}

      <s-section>
        <s-stack direction="block" gap="small">
          <s-text color="subdued">
            {post.blogTitle} · last updated {data.age} ·{" "}
            <s-link href={adminUrl} target="_blank">Open in Shopify</s-link>
          </s-text>
          <s-paragraph>
            Review each change below and accept or ignore it. The post is only updated in Shopify with the changes you accept. Its web address and published date stay exactly as they are.
            {data.skippedChecks.length ? ` We skipped the check on ${data.skippedChecks.join(" and ")} because your store has too many to read at once.` : ""}
          </s-paragraph>
          <RulesPanel rules={data.rules} />
        </s-stack>
      </s-section>

      <s-section heading="Before and after">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="large">
            <div>
              <s-text color="subdued">Words</s-text>
              <div style={{ fontSize: 18, fontWeight: 650 }}>
                {view.before.words} → {view.after.words}
              </div>
              <s-text color="subdued">{diff(view.before.words, view.after.words)}</s-text>
            </div>
            <div>
              <s-text color="subdued">SEO score</s-text>
              <div style={{ fontSize: 18, fontWeight: 650 }}>
                {view.before.seo} → {view.after.seo}
              </div>
              <s-text color="subdued">{diff(view.before.seo, view.after.seo)}</s-text>
            </div>
            <div>
              <s-text color="subdued">AI readiness</s-text>
              <div style={{ fontSize: 18, fontWeight: 650 }}>
                {view.before.ai.passed} → {view.after.ai.passed} of {view.after.ai.total}
              </div>
              <s-text color="subdued">{diff(view.before.ai.passed, view.after.ai.passed)}</s-text>
            </div>
          </s-stack>
          <s-text color="subdued">
            The "after" numbers update as you accept changes. Checks that depend on a search phrase (keyword in the title, heading, opening and URL) are left out, because we don't know what an older post was written to rank for.
          </s-text>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>SEO score: every check, <SeoBadge seo={view.after.seo} /></summary>
            <div style={{ marginTop: 8 }}>
              <ChecksTable before={view.before.seoChecks} after={view.after.seoChecks} />
            </div>
          </details>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>AI readiness: every check ({view.after.ai.passed} of {view.after.ai.total})</summary>
            <div style={{ marginTop: 8 }}>
              <ChecksTable before={view.before.aiChecks} after={view.after.aiChecks} />
            </div>
          </details>
        </s-stack>
      </s-section>

      <s-section heading={changes.length ? `Changes to review (${changes.length})` : "Changes to review"}>
        {changes.length === 0 ? (
          <s-paragraph>
            There is nothing to change in this post automatically. {data.notes.length ? "See below for things worth a look." : "It looks fine from what AI Refresh can check right now."}
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="small">
              <s-button onClick={() => set(changes.map((c) => c.id), "accepted")}>Accept all</s-button>
              <s-button variant="tertiary" onClick={() => set(changes.map((c) => c.id), "ignored")}>Ignore all</s-button>
              {undecided ? <s-text color="subdued">{undecided} not decided yet. Undecided changes are left as they are.</s-text> : null}
            </s-stack>
            {changes.map((c) => {
              const d = decision[c.id];
              return (
                <div key={c.id} style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 10, padding: 12 }}>
                  <s-stack direction="block" gap="small">
                    <s-text color="subdued">{c.detail} We would take the link off these words and keep the words.</s-text>
                    <div style={{ background: "rgba(200,40,40,0.07)", borderRadius: 6, padding: "8px 10px" }}>
                      <s-text color="subdued">Before</s-text>
                      <div>
                        {c.pre}
                        <u style={{ color: "#2a62d6" }}>{c.link}</u>
                        {c.post}
                      </div>
                    </div>
                    <div style={{ background: "rgba(30,140,60,0.08)", borderRadius: 6, padding: "8px 10px" }}>
                      <s-text color="subdued">After</s-text>
                      <div>
                        {c.pre}
                        {c.link}
                        {c.post}
                      </div>
                    </div>
                    <s-stack direction="inline" gap="small">
                      <s-button {...(d === "accepted" ? { variant: "primary" } : {})} onClick={() => set([c.id], "accepted")}>
                        {d === "accepted" ? "Accepted" : "Accept"}
                      </s-button>
                      <s-button variant="tertiary" onClick={() => set([c.id], "ignored")}>
                        {d === "ignored" ? "Ignored" : "Ignore"}
                      </s-button>
                    </s-stack>
                  </s-stack>
                </div>
              );
            })}
          </s-stack>
        )}
      </s-section>

      {data.notes.length ? (
        <s-section heading="Worth a look (we won't change these)">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              These are judgement calls, so they are left to you. Edit the post in Shopify if you want to change any of them.
            </s-text>
            {data.notes.map((n) => (
              <div key={n.id}>
                <s-text color="subdued">{n.where}</s-text>
                <div>“{n.context}”</div>
                <s-text>{n.message}</s-text>
              </div>
            ))}
          </s-stack>
        </s-section>
      ) : null}

      {data.history.length ? (
        <s-section heading="Refresh history">
          <s-stack direction="block" gap="base">
            {data.history.map((h) => (
              <s-stack key={h.id} direction="inline" gap="base" alignItems="center">
                <s-text>
                  {fmtDate(h.appliedAt)} · {h.accepted} change{h.accepted === 1 ? "" : "s"} accepted{h.ignored ? `, ${h.ignored} ignored` : ""} · words {h.wordsBefore} → {h.wordsAfter} · SEO {h.seoBefore} → {h.seoAfter} · AI ready {h.aiBefore} → {h.aiAfter}
                </s-text>
                {h.undone ? (
                  <s-badge>Undone</s-badge>
                ) : h.canUndo ? (
                  <s-button {...(busy ? { disabled: true } : {})} onClick={() => otherF.submit({ intent: "undo", runId: h.id }, { method: "POST" })}>
                    Undo
                  </s-button>
                ) : null}
              </s-stack>
            ))}
            <s-text color="subdued">An update can be undone for {UNDO_DAYS} days, as long as the post hasn't been edited since.</s-text>
          </s-stack>
        </s-section>
      ) : null}

      {!data.protectedPost ? (
        <s-section heading="Leave it alone">
          <s-stack direction="inline" gap="small">
            <s-button variant="tertiary" onClick={() => otherF.submit({ intent: "protect", kind: "post", on: "1" }, { method: "POST" })}>Never refresh this post</s-button>
            <s-button variant="tertiary" onClick={() => otherF.submit({ intent: "protect", kind: "blog", on: "1" }, { method: "POST" })}>Never refresh anything in "{post.blogTitle}"</s-button>
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
