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
  try {
    if (settings.linkToCollections) {
      const d = await gql<{ collections: { nodes: { title: string; handle: string; productsCount: { count: number } | null }[] } }>(
        admin,
        `#graphql
        query LinkCollections { collections(first: 100, query: "published_status:published", sortKey: TITLE) { nodes { title handle productsCount { count } } } }`,
      );
      targets.collections = d.collections.nodes.filter((c) => (c.productsCount?.count ?? 1) > 0).map((c) => ({ title: c.title, handle: c.handle }));
    }
    if (settings.linkToOtherArticles) {
      const seen = new Set<string>();
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
      // Anything else already published on the blog (matched on its title only).
      const d = await gql<{ articles: { nodes: { title: string; handle: string; blog: { handle: string } }[] } }>(
        admin,
        `#graphql
        query LinkArticles { articles(first: 50, query: "published_status:published", sortKey: PUBLISHED_AT, reverse: true) { nodes { title handle blog { handle } } } }`,
      );
      for (const a of d.articles.nodes) {
        const path = `/blogs/${a.blog.handle}/${a.handle}`;
        if (!seen.has(path)) targets.articles.push({ title: a.title, keyword: null, path });
      }
    }
  } catch (e) {
    // Links are a nice-to-have: never stop an article from being written because they couldn't be looked up.
    console.error("Could not load link targets", e);
  }
  return targets;
}
