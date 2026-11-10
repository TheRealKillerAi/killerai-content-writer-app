import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { buildContext, isProtected, loadPostChoices, loadPost, proposeAdds } from "../lib/refresh.server";
import { applyRefresh, refreshHistory, setProtected, undoRefresh, type AdditionIn, type RewriteIn } from "../lib/refreshStore.server";
import { factCheck, searchConfigured, suggestRewrite, type FactCheck } from "../lib/factcheck.server";
import { loadSettings } from "../lib/settings.server";
import { classifySource, SOURCE_LABEL } from "../lib/sources";
import { UNDO_DAYS } from "../lib/refreshRules";
import { proposeChanges, applyChanges, applyRewrites, type Note } from "../lib/refreshChanges";
import { ageLabel, hasFaq, hasTldr, scoreExisting } from "../lib/refresh";
import { applyLinkAdds, applyAdditions, ADD_FAQ_ID, ADD_TLDR_ID, type Addition } from "../lib/refreshAdd";
import { writeFaq, writeTldr } from "../lib/refreshAdd.server";
import { RulesPanel } from "../components/RulesPanel";
import { SeoBadge } from "../components/ArticleBadges";

const gidOf = (id: string) => `gid://shopify/Article/${id}`;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const post = await loadPost(admin, gidOf(params.id!));
  if (!post) return { missing: true as const };
  const { ctx, skippedChecks, settings } = await buildContext(admin, session.shop, [post]);
  const found = proposeChanges(post, ctx);
  const notes = found.notes;
  const changes = [...found.changes, ...(await proposeAdds(admin, session.shop, post, ctx, settings))];
  const months = Math.max(0, Math.round((Date.now() - new Date(post.updatedAt).getTime()) / (30.44 * 86400000)));
  return {
    missing: false as const,
    post,
    hosts: [...ctx.hosts],
    rules: ctx.rules!,
    changes,
    notes,
    skippedChecks,
    searchOn: searchConfigured(),
    needs: { tldr: !hasTldr(post.body) && ctx.rules!.add_tldr !== "off", faq: !hasFaq(post.body) && ctx.rules!.add_faq !== "off" },
    tldrStyle: {
      tldrEnabled: true, tldrLabel: settings.tldrLabel, tldrBg: settings.tldrBg, tldrText: settings.tldrText,
      tldrCorners: settings.tldrCorners, tldrFontSize: settings.tldrFontSize, tldrFont: settings.tldrFont,
    },
    age: ageLabel(months),
    protectedPost: await isProtected(session.shop, post),
    history: await refreshHistory(session.shop, post.id, post.body),
    postChoices: await loadPostChoices(admin, post.id).catch(() => []),
    store: session.shop.replace(".myshopify.com", ""),
  };
};

type ActionResult = { intent: string; ok: boolean; message: string; check?: FactCheck; sentence?: string; tldr?: string; faq?: { q: string; a: string }[] };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const gid = gidOf(params.id!);
  const by = (session as { email?: string | null }).email || session.shop;
  try {
    if (intent === "apply") {
      const list = (k: string) => String(form.get(k) ?? "").split(",").filter(Boolean);
      let replace: Record<string, string> = {};
      try {
        replace = JSON.parse(String(form.get("replace") ?? "{}"));
      } catch {
        /* no replacements */
      }
      let additions: AdditionIn[] = [];
      try {
        const raw = JSON.parse(String(form.get("additions") ?? "[]"));
        if (Array.isArray(raw))
          additions = raw
            .filter((x) => x && (x.decision === "accepted" || x.decision === "ignored") && ((x.kind === "tldr" && typeof x.text === "string") || (x.kind === "faq" && Array.isArray(x.items))))
            .slice(0, 2)
            .map((x) => (x.kind === "tldr" ? { id: ADD_TLDR_ID, kind: "tldr", text: x.text, decision: x.decision, detail: String(x.detail ?? "") } : { id: ADD_FAQ_ID, kind: "faq", items: x.items.map((f: { q: unknown; a: unknown }) => ({ q: String(f.q), a: String(f.a) })), decision: x.decision, detail: String(x.detail ?? "") }));
      } catch {
        /* no additions */
      }
      let rewrites: RewriteIn[] = [];
      try {
        const raw = JSON.parse(String(form.get("rewrites") ?? "[]"));
        if (Array.isArray(raw))
          rewrites = raw
            .filter((x) => x && typeof x.id === "string" && typeof x.before === "string" && typeof x.after === "string" && (x.decision === "accepted" || x.decision === "ignored"))
            .slice(0, 20)
            .map((x) => ({ id: x.id, before: x.before.slice(0, 1500), after: x.after.slice(0, 1500), decision: x.decision, detail: String(x.detail ?? "") }));
      } catch {
        /* no rewrites */
      }
      const r = await applyRefresh(admin, session.shop, gid, list("accepted"), list("ignored"), replace, rewrites, additions, by);
      if (!r.ok) return { intent, ok: false, message: r.error };
      return { intent, ok: true, message: `Updated the post with ${r.applied} change${r.applied === 1 ? "" : "s"}.${r.skipped ? ` ${r.skipped} could not be applied because the post had changed.` : ""} Shopify can take a few minutes to show the change on your store.` };
    }
    if (intent === "tldr" || intent === "faq") {
      const post = await loadPost(admin, gid);
      if (!post) return { intent, ok: false, message: "We couldn't find this post." };
      const settings = await loadSettings(session.shop);
      if (intent === "tldr") {
        const r = await writeTldr(post.title, post.body, settings);
        return r.ok ? { intent, ok: true, message: "", tldr: r.text } : { intent, ok: false, message: r.message };
      }
      const r = await writeFaq(post.title, post.body, settings);
      return r.ok ? { intent, ok: true, message: "", faq: r.items } : { intent, ok: false, message: r.message };
    }
    if (intent === "factcheck") {
      const r = await factCheck(String(form.get("sentence") ?? "").slice(0, 1500), String(form.get("updatedAt") ?? ""));
      return r.ok ? { intent, ok: true, message: "", check: r } : { intent, ok: false, message: r.message };
    }
    if (intent === "rewrite") {
      let check: FactCheck | null = null;
      try {
        const c = JSON.parse(String(form.get("check") ?? "null"));
        if (c && Array.isArray(c.sources) && Array.isArray(c.facts)) {
          // Trust is worked out again here from each address, never taken from the screen.
          const sources = c.sources.slice(0, 8).map((x: { n: number; title: string; url: string; date: string }, i: number) => {
            const k = classifySource(String(x.url));
            return { n: i + 1, title: String(x.title), url: String(x.url), domain: k.domain, type: k.type, label: SOURCE_LABEL[k.type], trusted: k.trusted, date: String(x.date ?? "") };
          });
          const facts = c.facts.slice(0, 10).map((f: { statement: string; quote: string; source: number }) => ({ statement: String(f.statement), quote: String(f.quote), source: Number(f.source) }));
          check = { ok: true, verdict: c.verdict === "changed" ? "changed" : "unclear", summary: String(c.summary ?? ""), facts, sources, canRewrite: c.verdict === "changed" && facts.some((f: { source: number }) => sources[f.source - 1]?.trusted) };
        }
      } catch {
        /* no fact check */
      }
      const settings = await loadSettings(session.shop);
      const r = await suggestRewrite({ sentence: String(form.get("sentence") ?? "").slice(0, 1500), hint: String(form.get("hint") ?? "").slice(0, 600), check, instructions: settings.refreshInstructions });
      return r.ok ? { intent, ok: true, message: "", sentence: r.sentence } : { intent, ok: false, message: r.message };
    }
    if (intent === "undo") {
      const r = await undoRefresh(admin, session.shop, String(form.get("runId")), form.get("force") === "1");
      return r.ok ? { intent, ok: true, message: "Undone. The post is back as it was. Shopify can take a few minutes to show the change on your store." } : { intent, ok: false, message: r.error };
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
/** Where a dead link used to point, in plain words, e.g. "the product "old bag" (/products/old-bag)". */
function wasPointingAt(href: string): string {
  const path = href.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
  const m = /\/(products|collections|blogs|pages)\/([^/]+)(?:\/([^/]+))?/.exec(path);
  if (!m) return href;
  const words = (h: string) => decodeURIComponent(h).replace(/[-_]+/g, " ");
  const kind = { products: "product", collections: "collection", blogs: "blog post", pages: "page" }[m[1]];
  return `the ${kind} "${words(m[3] ?? m[2])}" (${path})`;
}
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

type Proposal = { id: string; before: string; after: string; detail: string };

const VERDICT: Record<string, { tone: "success" | "warning" | "neutral"; label: string }> = {
  still_correct: { tone: "success", label: "Still correct" },
  changed: { tone: "warning", label: "Out of date" },
  unclear: { tone: "neutral", label: "Couldn't verify" },
};

/** Fact check, a note for the AI, and a suggested rewording for one sentence that mentions a past year. */
function SentenceCheck({
  note, updatedAt, searchOn, proposal, decision, onProposal, onDecide,
}: {
  note: Note;
  updatedAt: string;
  searchOn: boolean;
  proposal?: Proposal;
  decision?: "accepted" | "ignored";
  onProposal: (p: Proposal) => void;
  onDecide: (id: string, d: "accepted" | "ignored") => void;
}) {
  const sent = note.sentence!;
  const checkF = useFetcher<ActionResult>();
  const rewriteF = useFetcher<ActionResult>();
  const [hint, setHint] = useState("");
  const check = checkF.data?.check ?? null;
  const rewritten = rewriteF.data?.sentence;

  useEffect(() => {
    if (!rewritten) return;
    const detail = JSON.stringify({ hint: hint || undefined, summary: check?.summary, sources: check?.sources.map((x) => ({ title: x.title, url: x.url, type: x.label })) });
    onProposal({ id: sent.id, before: sent.html, after: rewritten, detail });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewritten]);

  return (
    <s-stack direction="block" gap="small">
      {searchOn ? (
        <s-stack direction="inline" gap="small">
          <s-button {...(checkF.state !== "idle" ? { loading: true } : {})} onClick={() => checkF.submit({ intent: "factcheck", sentence: sent.text, updatedAt }, { method: "POST" })}>
            Fact check this
          </s-button>
        </s-stack>
      ) : (
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-button disabled>Fact check this</s-button>
          <s-badge tone="info">Higher plans</s-badge>
          <s-text color="subdued">Checks the claim against reliable sources. <s-link href="/app/plans">See plans</s-link></s-text>
        </s-stack>
      )}
      {checkF.data && !checkF.data.ok ? <s-text tone="critical">{checkF.data.message}</s-text> : null}
      {check ? (
        <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, padding: 10 }}>
          <s-stack direction="block" gap="small">
            <div>
              <s-badge tone={VERDICT[check.verdict].tone}>{VERDICT[check.verdict].label}</s-badge> {check.summary}
            </div>
            {check.facts.map((f, i) => (
              <div key={i}>
                <s-text>{f.statement} </s-text>
                <s-text color="subdued">[{f.source}]</s-text>
              </div>
            ))}
            {check.sources.length ? (
              <div>
                <s-text color="subdued">Sources. Please judge for yourself whether you trust them:</s-text>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {check.sources.map((x) => (
                    <li key={x.n}>
                      [{x.n}] <a href={x.url} target="_blank" rel="noreferrer">{x.title}</a> · {x.domain} · {x.label}
                      {x.date ? ` · ${x.date.slice(0, 10)}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </s-stack>
        </div>
      ) : null}
      {sent.editable ? (
        <>
          <s-text-field label="Note for the AI (optional)" placeholder="For example: now replaced by the 2025 plan" value={hint} onInput={(e: Event) => setHint((e.currentTarget as unknown as { value: string }).value)} />
          <s-stack direction="inline" gap="small">
            <s-button
              {...(rewriteF.state !== "idle" ? { loading: true } : {})}
              {...(!hint.trim() && !check?.canRewrite ? { disabled: true } : {})}
              onClick={() => rewriteF.submit({ intent: "rewrite", sentence: sent.text, hint, check: JSON.stringify(check) }, { method: "POST" })}
            >
              Suggest a rewording
            </s-button>
            {!hint.trim() && !check?.canRewrite ? <s-text color="subdued">Add a note about what it should say now to enable this.</s-text> : null}
          </s-stack>
          {rewriteF.data && !rewriteF.data.ok ? <s-text tone="critical">{rewriteF.data.message}</s-text> : null}
          {proposal ? (
            <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 10, padding: 12 }}>
              <s-stack direction="block" gap="small">
                <div style={{ background: "rgba(200,40,40,0.07)", borderRadius: 6, padding: "8px 10px" }}>
                  <s-text color="subdued">Before</s-text>
                  <div>{sent.text}</div>
                </div>
                <div style={{ background: "rgba(30,140,60,0.08)", borderRadius: 6, padding: "8px 10px" }}>
                  <s-text color="subdued">After</s-text>
                  <div>{proposal.after}</div>
                </div>
                <s-stack direction="inline" gap="small">
                  <s-button {...(decision === "accepted" ? { variant: "primary" } : {})} onClick={() => onDecide(proposal.id, "accepted")}>{decision === "accepted" ? "Accepted" : "Accept"}</s-button>
                  <s-button variant="tertiary" onClick={() => onDecide(proposal.id, "ignored")}>{decision === "ignored" ? "Ignored" : "Ignore"}</s-button>
                </s-stack>
              </s-stack>
            </div>
          ) : null}
        </>
      ) : (
        <s-text color="subdued">This sentence has a link or formatting inside it, so edit it in Shopify.</s-text>
      )}
    </s-stack>
  );
}

/** Write a TL;DR or an FAQ for the post, then accept or ignore it. */
function AddBlock({ kind, added, decision, onAdd, onDecide }: { kind: "tldr" | "faq"; added?: Addition & { detail: string }; decision?: "accepted" | "ignored"; onAdd: (a: Addition & { detail: string }) => void; onDecide: (id: string, d: "accepted" | "ignored") => void }) {
  const f = useFetcher<ActionResult>();
  const id = kind === "tldr" ? ADD_TLDR_ID : ADD_FAQ_ID;
  const tldr = f.data?.tldr;
  const faq = f.data?.faq;
  useEffect(() => {
    if (tldr) onAdd({ id, kind: "tldr", text: tldr, detail: "Written from the post's own text" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tldr]);
  useEffect(() => {
    if (faq) onAdd({ id, kind: "faq", items: faq, detail: "Written from the post's own text" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faq]);
  return (
    <s-stack direction="block" gap="small">
      <div>
        <strong>{kind === "tldr" ? "No short summary (TL;DR) at the top" : "No FAQ"}</strong>
      </div>
      <s-stack direction="inline" gap="small">
        <s-button {...(f.state !== "idle" ? { loading: true } : {})} onClick={() => f.submit({ intent: kind }, { method: "POST" })}>
          {added ? "Write it again" : kind === "tldr" ? "Write a short summary" : "Write an FAQ"}
        </s-button>
      </s-stack>
      {f.data && !f.data.ok ? <s-text tone="critical">{f.data.message}</s-text> : null}
      {added ? (
        <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 10, padding: 12 }}>
          <s-stack direction="block" gap="small">
            <div style={{ background: "rgba(30,140,60,0.08)", borderRadius: 6, padding: "8px 10px" }}>
              <s-text color="subdued">{kind === "tldr" ? "Added at the top" : "Added at the end"}</s-text>
              {added.kind === "tldr" ? (
                <div>
                  <strong>TL;DR:</strong> {added.text}
                </div>
              ) : (
                added.items.map((q, i) => (
                  <div key={i} style={{ marginTop: 6 }}>
                    <strong>{q.q}</strong>
                    <div>{q.a}</div>
                  </div>
                ))
              )}
            </div>
            <s-stack direction="inline" gap="small">
              <s-button {...(decision === "accepted" ? { variant: "primary" } : {})} onClick={() => onDecide(id, "accepted")}>{decision === "accepted" ? "Accepted" : "Accept"}</s-button>
              <s-button variant="tertiary" onClick={() => onDecide(id, "ignored")}>{decision === "ignored" ? "Ignored" : "Ignore"}</s-button>
            </s-stack>
          </s-stack>
        </div>
      ) : null}
    </s-stack>
  );
}

export default function RefreshPost() {
  const data = useLoaderData<typeof loader>();
  const applyF = useFetcher<ActionResult>();
  const otherF = useFetcher<ActionResult>();
  const [decision, setDecision] = useState<Record<string, "accepted" | "ignored">>({});
  const [replacement, setReplacement] = useState<Record<string, { path: string; label: string }>>({});
  const [added, setAdded] = useState<Record<string, Addition & { detail: string }>>({});
  const [rewrites, setRewrites] = useState<Record<string, Proposal>>({});
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [postPick, setPostPick] = useState<string | null>(null);

  // Everything below needs the post; the hooks above must run first.
  const post = data.missing ? null : data.post;
  const changes = data.missing ? [] : data.changes;
  const acceptedList = changes.filter((c) => decision[c.id] === "accepted");
  const acceptedRewrites = Object.values(rewrites).filter((r) => decision[r.id] === "accepted");
  const acceptedAdds = Object.values(added).filter((x) => decision[x.id] === "accepted");
  const totalAccepted = acceptedList.length + acceptedRewrites.length + acceptedAdds.length;

  const view = useMemo(() => {
    if (!post || data.missing) return null;
    const hosts = new Set(data.hosts);
    const removes = acceptedList.filter((c) => c.kind === "remove_link");
    const adds = acceptedList.filter((c) => c.kind === "add_link");
    const next = applyChanges(post.body, removes.map((c) => ({ index: c.index, href: c.href, newHref: replacement[c.id]?.path })));
    const linked = applyLinkAdds(next.html, adds.map((c) => ({ index: c.index, link: c.link, href: c.href })));
    const rw = applyRewrites(linked.html, acceptedRewrites);
    const full = applyAdditions(rw.html, acceptedAdds, data.tldrStyle);
    return { before: scoreExisting(post, hosts), after: scoreExisting({ ...post, body: full }, hosts) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post, decision, replacement, rewrites, added]);

  useEffect(() => {
    if (applyF.data?.intent === "apply" && applyF.data.ok) {
      setDecision({});
      setReplacement({});
      setRewrites({});
      setAdded({});
    }
    if (otherF.data?.intent === "undo") setConfirmRestore(null);
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
  const pick = async (id: string, type: "product" | "collection") => {
    const api = (window as unknown as { shopify?: { resourcePicker?: (o: { type: string; multiple: boolean; action: string }) => Promise<{ selection: { handle?: string; title?: string }[] } | undefined> } }).shopify;
    const res = await api?.resourcePicker?.({ type, multiple: false, action: "select" });
    const item = res?.selection?.[0];
    if (!item?.handle) return;
    setReplacement((p) => ({ ...p, [id]: { path: `/${type === "product" ? "products" : "collections"}/${item.handle}`, label: item.title ?? item.handle! } }));
    set([id], "accepted");
  };
  const chooseReplacement = (id: string, path: string, label: string) => {
    setReplacement((p) => ({ ...p, [id]: { path, label } }));
    setPostPick(null);
    set([id], "accepted");
  };

  return (
    <s-page heading={post.title}>
      <s-link slot="breadcrumb-actions" href="/app/refresh">AI Refresh</s-link>
      <s-button slot="primary-action" variant="primary" {...(totalAccepted === 0 ? { disabled: true } : {})} {...(applyF.state !== "idle" ? { loading: true } : {})}
        onClick={() => applyF.submit({ intent: "apply", accepted: acceptedList.map((c) => c.id).join(","), ignored: ignoredIds.join(","), additions: JSON.stringify(Object.values(added).filter((x) => decision[x.id]).map((x) => ({ ...x, decision: decision[x.id] }))), rewrites: JSON.stringify(Object.values(rewrites).filter((r) => decision[r.id]).map((r) => ({ ...r, decision: decision[r.id] }))), replace: JSON.stringify(Object.fromEntries(acceptedList.filter((c) => replacement[c.id]).map((c) => [c.id, replacement[c.id].path]))) }, { method: "POST" })}>
        {totalAccepted ? `Update this post in Shopify (${totalAccepted} change${totalAccepted === 1 ? "" : "s"})` : "Update this post in Shopify"}
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
            Review each change below and accept or ignore it. The post is only updated in Shopify with the changes you accept. Its web address and published date stay exactly as they are. After you update, Shopify can take a few minutes to show the change on your store.
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
                    {c.kind === "add_link" ? (
                      <s-text color="subdued">{c.detail} We would link these words to {wasPointingAt(c.href)}.</s-text>
                    ) : (
                      <s-text color="subdued">{c.detail} This link pointed to {wasPointingAt(c.href)}. We would take the link off these words and keep the words.</s-text>
                    )}
                    <div style={{ background: "rgba(200,40,40,0.07)", borderRadius: 6, padding: "8px 10px" }}>
                      <s-text color="subdued">Before</s-text>
                      <div>
                        {c.pre}
                        {c.kind === "add_link" ? c.link : <u style={{ color: "#2a62d6" }}>{c.link}</u>}
                        {c.post}
                      </div>
                    </div>
                    <div style={{ background: "rgba(30,140,60,0.08)", borderRadius: 6, padding: "8px 10px" }}>
                      <s-text color="subdued">After</s-text>
                      <div>
                        {c.pre}
                        {replacement[c.id] || c.kind === "add_link" ? <u style={{ color: "#2a62d6" }}>{c.link}</u> : c.link}
                        {c.post}
                      </div>
                      {replacement[c.id] ? <s-text color="subdued">Now links to {replacement[c.id].label}</s-text> : null}
                    </div>
                    <s-stack direction="inline" gap="small">
                      <s-button {...(d === "accepted" ? { variant: "primary" } : {})} onClick={() => set([c.id], "accepted")}>
                        {d === "accepted" ? "Accepted" : "Accept"}
                      </s-button>
                      <s-button variant="tertiary" onClick={() => set([c.id], "ignored")}>
                        {d === "ignored" ? "Ignored" : "Ignore"}
                      </s-button>
                      {c.kind === "remove_link" ? (
                        <>
                          <s-button variant="tertiary" onClick={() => pick(c.id, "product")}>Replace with a product…</s-button>
                          <s-button variant="tertiary" onClick={() => pick(c.id, "collection")}>…a collection</s-button>
                          <s-button variant="tertiary" onClick={() => setPostPick(postPick === c.id ? null : c.id)}>…a blog post</s-button>
                        </>
                      ) : null}
                      {replacement[c.id] ? (
                        <s-button variant="tertiary" onClick={() => setReplacement((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== c.id)))}>Just remove the link</s-button>
                      ) : null}
                    </s-stack>
                    {postPick === c.id ? (
                      <s-select label="Choose a blog post" value="" onChange={(e: Event) => {
                        const path = (e.currentTarget as unknown as { value: string }).value;
                        const choice = data.postChoices.find((x) => x.path === path);
                        if (choice) chooseReplacement(c.id, choice.path, choice.title);
                      }}>
                        <s-option value="">Choose…</s-option>
                        {data.postChoices.map((x) => (
                          <s-option key={x.path} value={x.path}>{x.title}</s-option>
                        ))}
                      </s-select>
                    ) : null}
                  </s-stack>
                </div>
              );
            })}
          </s-stack>
        )}
      </s-section>

      {data.needs.tldr || data.needs.faq ? (
        <s-section heading="Add what's missing">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              These are written only from what this post already says. Nothing new is added, and every figure has to appear in the post. Nothing changes until you accept it and update the post.
            </s-text>
            {data.needs.tldr ? <AddBlock kind="tldr" added={added[ADD_TLDR_ID]} decision={decision[ADD_TLDR_ID]} onAdd={(a) => setAdded((m) => ({ ...m, [a.id]: a }))} onDecide={(id, d) => set([id], d)} /> : null}
            {data.needs.faq ? <AddBlock kind="faq" added={added[ADD_FAQ_ID]} decision={decision[ADD_FAQ_ID]} onAdd={(a) => setAdded((m) => ({ ...m, [a.id]: a }))} onDecide={(id, d) => set([id], d)} /> : null}
          </s-stack>
        </s-section>
      ) : null}

      {data.notes.length ? (
        <s-section heading="Worth a look">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              These are judgement calls, so nothing here changes unless you ask. For a sentence with a past year you can add a note about what is true now and ask for a reworded sentence, which you then accept or ignore. The AI only uses what your note says. Check it is right before you accept. Otherwise edit the post in Shopify.
            </s-text>
            {data.notes.map((n) => (
              <div key={n.id}>
                <s-text color="subdued">{n.where}</s-text>
                <div>“{n.context}”</div>
                <s-text>{n.message}</s-text>
                {n.sentence ? (
                  <div style={{ marginTop: 8 }}>
                    <SentenceCheck
                      note={n}
                      updatedAt={post.updatedAt}
                      searchOn={data.searchOn}
                      proposal={rewrites[n.sentence.id]}
                      decision={decision[n.sentence.id]}
                      onProposal={(p) => setRewrites((r) => ({ ...r, [p.id]: p }))}
                      onDecide={(id, d) => set([id], d)}
                    />
                  </div>
                ) : null}
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
                ) : h.canUndo && !h.editedSince ? (
                  <s-button {...(busy ? { disabled: true } : {})} onClick={() => otherF.submit({ intent: "undo", runId: h.id }, { method: "POST" })}>
                    Undo
                  </s-button>
                ) : h.canUndo ? (
                  confirmRestore === h.id ? (
                    <s-stack direction="block" gap="small">
                      <s-text>
                        This post has been edited since this update. Restoring the backup puts the post back exactly as it was before the update and <strong>overwrites the edits made since</strong>.
                      </s-text>
                      <s-stack direction="inline" gap="small">
                        <s-button variant="primary" {...(busy ? { disabled: true } : {})} onClick={() => otherF.submit({ intent: "undo", runId: h.id, force: "1" }, { method: "POST" })}>
                          Yes, restore and overwrite later edits
                        </s-button>
                        <s-button variant="tertiary" onClick={() => setConfirmRestore(null)}>Cancel</s-button>
                      </s-stack>
                    </s-stack>
                  ) : (
                    <s-button onClick={() => setConfirmRestore(h.id)}>Restore backup…</s-button>
                  )
                ) : null}
              </s-stack>
            ))}
            <s-text color="subdued">The old version is kept for {UNDO_DAYS} days. If the post has been edited since, you can still restore the backup, but it will overwrite those edits and we'll ask you to confirm first.</s-text>
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
