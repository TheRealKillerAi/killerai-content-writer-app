import db from "../db.server";
import { gql, type Admin } from "./products.server";
import type { AppSettings } from "./settings";
import type { LinkTargets } from "./pipeline/links";
import type { ArticleResult } from "./pipeline/types";

/** The collections and published articles an article may link to. Returns nothing when both link options are off. */
export async function loadLinkTargets(
  admin: Admin | undefined,
  shop: string,
  settings: AppSettings,
  selfKeyword: string,
  selfId?: string,
): Promise<LinkTargets | undefined> {
  if (!admin || (!settings.linkToCollections && !settings.linkToOtherArticles)) return undefined;
  const targets: LinkTargets = { collections: [], articles: [], selfKeyword };
  // Each lookup has its own safety net: if one fails the other still works, and the article is always written.
  if (settings.linkToCollections) {
    try {
      const d = await gql<{ collections: { nodes: { title: string; handle: string; productsCount: { count: number } | null }[] } }>(
        admin,
        `#graphql
        query LinkCollections { collections(first: 100, query: "published_status:published", sortKey: TITLE) { nodes { title handle productsCount { count } } } }`,
      );
      targets.collections = d.collections.nodes.filter((c) => (c.productsCount?.count ?? 1) > 0).map((c) => ({ title: c.title, handle: c.handle }));
    } catch (e) {
      console.error("Could not load collections for links", e);
    }
  }
  if (settings.linkToOtherArticles) {
    const seen = new Set<string>();
    try {
      // Articles this app wrote and published (we know the search phrase each one targets).
      const rows = await db.article.findMany({
        where: { shop, sentAs: "live", ...(selfId ? { id: { not: selfId } } : {}) },
        select: { keyword: true, title: true, result: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      for (const r of rows) {
        try {
          const res = JSON.parse(r.result ?? "null") as ArticleResult | null;
          const sent = res?.sent;
          if (!res || !sent?.published || !sent.handle || !sent.blogHandle) continue;
          const path = `/blogs/${sent.blogHandle}/${sent.handle}`;
          seen.add(path);
          targets.articles.push({ title: res.article.h1 || r.title || "", keyword: r.keyword, path });
        } catch {
          /* skip an unreadable row */
        }
      }
    } catch (e) {
      console.error("Could not load this app's published articles for links", e);
    }
    try {
      // Anything else already on the blogs (matched on its title only). Newest first; published ones only.
      const d = await gql<{ articles: { nodes: { title: string; handle: string; isPublished: boolean; blog: { handle: string } }[] } }>(
        admin,
        `#graphql
        query LinkArticles { articles(first: 100, sortKey: PUBLISHED_AT, reverse: true) { nodes { title handle isPublished blog { handle } } } }`,
      );
      for (const a of d.articles.nodes) {
        if (!a.isPublished) continue;
        const path = `/blogs/${a.blog.handle}/${a.handle}`;
        if (!seen.has(path)) targets.articles.push({ title: a.title, keyword: null, path });
      }
    } catch (e) {
      console.error("Could not load blog articles for links", e);
    }
  }
  return targets;
}
