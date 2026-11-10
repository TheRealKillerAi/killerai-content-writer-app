// AI Refresh, stage 2: updating a post in Shopify, the audit trail, undo, and protected posts.
import db from "../db.server";
import { gql, type Admin } from "./products.server";
import { buildContext, loadPost, proposeAdds } from "./refresh.server";
import { applyChanges, applyRewrites, proposeChanges, safeStorePath } from "./refreshChanges";
import { hasFaq, hasTldr, scoreExisting } from "./refresh";
import { applyAdditions, applyLinkAdds } from "./refreshAdd";
import { UNDO_DAYS } from "./refreshRules";


const UPDATE_BODY = `#graphql
  mutation RefreshUpdate($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) { article { id body } userErrors { field message } }
  }`;

async function writeBody(admin: Admin, gid: string, body: string): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  // Only the body is sent: the handle (URL), published date, author, image and search fields are never touched.
  const d = await gql<{ articleUpdate: { article: { body: string } | null; userErrors: { message: string }[] } }>(admin, UPDATE_BODY, { id: gid, article: { body } });
  const errs = d.articleUpdate.userErrors;
  if (errs.length || !d.articleUpdate.article) return { ok: false, error: errs.map((e) => e.message).join("; ") || "Shopify did not accept the update." };
  return { ok: true, body: d.articleUpdate.article.body };
}

export type RewriteIn = { id: string; before: string; after: string; decision: "accepted" | "ignored"; detail: string };
export type AdditionIn = ({ id: string; kind: "tldr"; text: string } | { id: string; kind: "faq"; items: { q: string; a: string }[] }) & { decision: "accepted" | "ignored"; detail: string };

export type ApplyResult = { ok: true; applied: number; runId: string; skipped: number } | { ok: false; error: string };

const clean = (t: unknown, max: number) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The date shown on a "Last updated" line, in the store's own time zone. */
async function todayInStore(admin: Admin): Promise<string> {
  let tz = "UTC";
  try {
    tz = (await gql<{ shop: { ianaTimezone: string } }>(admin, `#graphql\n    query RefreshTz { shop { ianaTimezone } }`)).shop.ianaTimezone || "UTC";
  } catch {
    /* use UTC */
  }
  return new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: tz });
}

const LAST_UPDATED = /<p data-ai-refresh="last-updated">[\s\S]*?<\/p>\s*/i;

/** Applies the changes the merchant accepted. Everything is worked out again from the post as it is now, so a post edited since the page opened is never overwritten blindly. */
export async function applyRefresh(
  admin: Admin,
  shop: string,
  gid: string,
  accepted: string[],
  ignored: string[],
  replace: Record<string, string>,
  rewrites: RewriteIn[],
  additions: AdditionIn[],
  by: string,
): Promise<ApplyResult> {
  const post = await loadPost(admin, gid);
  if (!post) return { ok: false, error: "We couldn't find this post any more." };
  const { ctx, settings } = await buildContext(admin, shop, [post]);
  const changes = [...proposeChanges(post, ctx).changes, ...(await proposeAdds(admin, shop, post, ctx, settings))];
  const take = changes.filter((c) => accepted.includes(c.id));
  const removes = take.filter((c) => c.kind === "remove_link");
  const adds = take.filter((c) => c.kind === "add_link");
  const rwTake = rewrites.filter((r) => r.decision === "accepted");
  // A summary or FAQ is only added if the post still lacks one.
  const addTake = additions
    .filter((x) => x.decision === "accepted")
    .filter((x) => (x.kind === "tldr" ? !hasTldr(post.body) && ctx.rules?.add_tldr !== "off" : !hasFaq(post.body) && ctx.rules?.add_faq !== "off"))
    .map((x) => (x.kind === "tldr" ? ({ id: x.id, kind: "tldr", text: clean(x.text, 600) } as const) : ({ id: x.id, kind: "faq", items: x.items.slice(0, 5).map((f) => ({ q: clean(f.q, 200), a: clean(f.a, 600) })).filter((f) => f.q && f.a) } as const)))
    .filter((x) => (x.kind === "tldr" ? !!x.text : x.items.length >= 2));
  if (!take.length && !rwTake.length && !addTake.length) return { ok: false, error: "None of the accepted changes apply to this post any more. Reload the page to see what is left." };

  const newOf = (id: string) => (replace[id] ? safeStorePath(replace[id]) ?? undefined : undefined);
  const next = applyChanges(post.body, removes.map((c) => ({ index: c.index, href: c.href, newHref: newOf(c.id) })));
  const addedLinks = applyLinkAdds(next.html, adds.map((c) => ({ index: c.index, link: c.link, href: c.href })));
  const rw = applyRewrites(addedLinks.html, rwTake);
  let html = applyAdditions(rw.html, addTake, settings);
  const count = next.applied.length + addedLinks.applied.length + rw.applied.length + addTake.length;
  if (!count || html === post.body) return { ok: false, error: "The post has changed since you opened this page. Reload to see what is left." };
  if (settings.refreshLastUpdated) {
    const line = `<p data-ai-refresh="last-updated"><em>Last updated: ${await todayInStore(admin)}</em></p>\n`;
    html = LAST_UPDATED.test(html) ? html.replace(LAST_UPDATED, line) : line + html;
  }

  const before = scoreExisting(post, ctx.hosts);
  const saved = await writeBody(admin, gid, html);
  if (!saved.ok) return { ok: false, error: saved.error };
  const after = scoreExisting({ ...post, body: saved.body }, ctx.hosts);

  const doneRemoves = removes.filter((c) => next.applied.includes(c.index));
  const doneAdds = adds.filter((c) => addedLinks.applied.includes(c.index));
  const skipped = take.length - doneRemoves.length - doneAdds.length + (rwTake.length - rw.applied.length);
  const rest = changes.filter((c) => ignored.includes(c.id) && !accepted.includes(c.id));
  const rec = (c: (typeof changes)[number], decision: string, replaced?: string) => ({
    shop,
    articleId: gid,
    rule: c.rule,
    kind: replaced ? "replace_link" : c.kind,
    before: `${c.pre}${c.link}${c.post}`.trim(),
    after: replaced ? `${c.link} (now links to ${replaced})` : c.kind === "add_link" ? `${c.link} (now links to ${c.href})` : c.link,
    detail: `${c.href} — ${c.detail}`,
    decision,
  });
  const run = await db.refreshRun.create({
    data: {
      shop,
      articleId: gid,
      articleTitle: post.title,
      handle: post.handle,
      bodyBefore: post.body,
      bodyAfter: saved.body,
      wordsBefore: before.words,
      wordsAfter: after.words,
      seoBefore: before.seo,
      seoAfter: after.seo,
      aiBefore: before.ai.passed,
      aiAfter: after.ai.passed,
      appliedBy: by,
      changes: {
        create: [
          ...doneRemoves.map((c) => rec(c, "accepted", newOf(c.id))),
          ...doneAdds.map((c) => rec(c, "accepted")),
          ...rewrites
            .filter((r) => (r.decision === "accepted" ? rw.applied.includes(r.id) : true))
            .map((r) => ({ shop, articleId: gid, rule: "old_year", kind: "rewrite_sentence", before: r.before.slice(0, 1500), after: r.after.slice(0, 1500), detail: r.detail.slice(0, 3000), decision: r.decision })),
          ...additions
            .filter((x) => (x.decision === "accepted" ? addTake.some((t) => t.id === x.id) : true))
            .map((x) => ({
              shop,
              articleId: gid,
              rule: x.kind === "tldr" ? "add_tldr" : "add_faq",
              kind: x.kind === "tldr" ? "add_tldr" : "add_faq",
              before: "",
              after: x.kind === "tldr" ? clean(x.text, 1500) : x.items.map((f) => `Q: ${clean(f.q, 200)} A: ${clean(f.a, 600)}`).join("\n").slice(0, 3000),
              detail: clean(x.detail, 1000),
              decision: x.decision,
            })),
          ...rest.map((c) => rec(c, "ignored")),
        ],
      },
    },
  });
  return { ok: true, applied: count, runId: run.id, skipped };
}

export function canUndo(run: { appliedAt: Date; undoneAt: Date | null; bodyBefore: string | null }) {
  return !run.undoneAt && !!run.bodyBefore && Date.now() - run.appliedAt.getTime() < UNDO_DAYS * 86400000;
}

export async function undoRefresh(admin: Admin, shop: string, runId: string, force = false): Promise<{ ok: true } | { ok: false; error: string }> {
  const run = await db.refreshRun.findFirst({ where: { id: runId, shop } });
  if (!run) return { ok: false, error: "We couldn't find that update." };
  if (!canUndo(run)) return { ok: false, error: `This update can no longer be undone. Updates can be undone for ${UNDO_DAYS} days.` };
  const post = await loadPost(admin, run.articleId);
  if (!post) return { ok: false, error: "We couldn't find this post any more." };
  if (post.body !== run.bodyAfter && !force) {
    return { ok: false, error: "This post has been edited since the update. Choose 'Restore backup' and confirm to put the older version back anyway." };
  }
  const saved = await writeBody(admin, run.articleId, run.bodyBefore!);
  if (!saved.ok) return { ok: false, error: saved.error };
  await db.refreshRun.update({ where: { id: run.id }, data: { undoneAt: new Date() } });
  return { ok: true };
}

export async function refreshHistory(shop: string, gid: string, currentBody: string) {
  const runs = await db.refreshRun.findMany({ where: { shop, articleId: gid }, orderBy: { appliedAt: "desc" }, take: 10, include: { changes: true } });
  return runs.map((r) => ({
    id: r.id,
    appliedAt: r.appliedAt.toISOString(),
    appliedBy: r.appliedBy,
    undone: !!r.undoneAt,
    canUndo: canUndo(r),
    editedSince: r.bodyAfter !== null && r.bodyAfter !== currentBody,
    wordsBefore: r.wordsBefore,
    wordsAfter: r.wordsAfter,
    seoBefore: r.seoBefore,
    seoAfter: r.seoAfter,
    aiBefore: r.aiBefore,
    aiAfter: r.aiAfter,
    accepted: r.changes.filter((c) => c.decision === "accepted").length,
    ignored: r.changes.filter((c) => c.decision === "ignored").length,
  }));
}

export async function setProtected(shop: string, kind: "post" | "blog", ref: string, label: string, on: boolean) {
  if (on) {
    await db.refreshProtected.upsert({ where: { shop_kind_ref: { shop, kind, ref } }, create: { shop, kind, ref, label }, update: { label } });
  } else {
    await db.refreshProtected.deleteMany({ where: { shop, kind, ref } });
  }
}

export async function listProtected(shop: string) {
  return db.refreshProtected.findMany({ where: { shop }, orderBy: { createdAt: "desc" } });
}
