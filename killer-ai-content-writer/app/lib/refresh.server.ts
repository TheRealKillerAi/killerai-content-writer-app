import { gql, type Admin } from "./products.server";
import db from "../db.server";
import { analysePost, productHandlesIn, type BlogPost, type PostReview, type RefreshContext } from "./refresh";
import { cleanRules } from "./refreshRules";
import { loadSettings } from "./settings.server";

type PostNode = {
  id: string;
  title: string;
  handle: string;
  body: string | null;
  summary: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  updatedAt: string;
  blog: { handle: string; title: string };
  author: { name: string } | null;
  image: { url: string; altText: string | null } | null;
  titleTag: { value: string } | null;
  descriptionTag: { value: string } | null;
};

const POST_FIELDS = `id title handle body summary isPublished publishedAt updatedAt
  blog { handle title }
  author { name }
  image { url altText }
  titleTag: metafield(namespace: "global", key: "title_tag") { value }
  descriptionTag: metafield(namespace: "global", key: "description_tag") { value }`;

const POSTS_QUERY = `#graphql
  query RefreshPosts($first: Int!, $after: String) {
    articles(first: $first, after: $after, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { ${POST_FIELDS} }
    }
  }`;

function postFromNode(n: PostNode): BlogPost {
  return {
    id: n.id,
    title: n.title,
    handle: n.handle,
    blogHandle: n.blog.handle,
    blogTitle: n.blog.title,
    body: n.body ?? "",
    summary: n.summary ?? "",
    isPublished: n.isPublished,
    publishedAt: n.publishedAt,
    updatedAt: n.updatedAt,
    author: n.author?.name ?? "",
    image: n.image,
    titleTag: n.titleTag?.value ?? "",
    metaDescription: n.descriptionTag?.value ?? "",
  };
}

/** One post by its Shopify id (gid), or null when it doesn't exist. */
export async function loadPost(admin: Admin, gid: string): Promise<BlogPost | null> {
  const d = await gql<{ article: PostNode | null }>(admin, `#graphql\n    query RefreshPost($id: ID!) { article(id: $id) { ${POST_FIELDS} } }`, { id: gid });
  return d.article ? postFromNode(d.article) : null;
}

/** The published posts that were updated longest ago, oldest first. */
async function loadPosts(admin: Admin, limit: number): Promise<BlogPost[]> {
  const out: BlogPost[] = [];
  let after: string | null = null;
  for (let page = 0; page < 3 && out.length < limit; page++) {
    const d: { articles: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: PostNode[] } } = await gql(admin, POSTS_QUERY, { first: 50, after });
    for (const n of d.articles.nodes) {
      if (!n.isPublished) continue;
      out.push(postFromNode(n));
    }
    if (!d.articles.pageInfo.hasNextPage) break;
    after = d.articles.pageInfo.endCursor;
  }
  return out.slice(0, limit);
}

async function loadPostPaths(admin: Admin): Promise<{ paths: Set<string>; total: number }> {
  const paths = new Set<string>();
  let after: string | null = null;
  let total = 0;
  for (let page = 0; page < 4; page++) {
    const d: { articles: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { handle: string; isPublished: boolean; blog: { handle: string } }[] } } = await gql(
      admin,
      `#graphql
      query PostPaths($after: String) { articles(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { handle isPublished blog { handle } } } }`,
      { after },
    );
    for (const n of d.articles.nodes) {
      total++;
      if (n.isPublished) paths.add(`${n.blog.handle}/${n.handle}`);
    }
    if (!d.articles.pageInfo.hasNextPage) return { paths, total };
    after = d.articles.pageInfo.endCursor;
  }
  return { paths, total: -1 }; // more than we read: the caller must not treat a missing post as gone
}

async function loadCollectionHandles(admin: Admin): Promise<Set<string> | null> {
  const out = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < 4; page++) {
    const d: { collections: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { handle: string }[] } } = await gql(
      admin,
      `#graphql
      query CollectionHandles($after: String) { collections(first: 250, after: $after, query: "published_status:published") { pageInfo { hasNextPage endCursor } nodes { handle } } }`,
      { after },
    );
    d.collections.nodes.forEach((c) => out.add(c.handle));
    if (!d.collections.pageInfo.hasNextPage) return out;
    after = d.collections.pageInfo.endCursor;
  }
  return null;
}

async function loadProducts(admin: Admin, handles: string[]) {
  const out = new Map<string, { status: string; outOfStock: boolean }>();
  for (let i = 0; i < handles.length; i += 20) {
    const chunk = handles.slice(i, i + 20);
    const q = chunk.map((h) => `handle:'${h.replace(/['\\]/g, "")}'`).join(" OR ");
    const d: { products: { nodes: { handle: string; status: string; totalInventory: number | null; tracksInventory: boolean }[] } } = await gql(
      admin,
      `#graphql
      query RefreshProducts($q: String!) { products(first: 20, query: $q) { nodes { handle status totalInventory tracksInventory } } }`,
      { q },
    );
    for (const p of d.products.nodes) out.set(p.handle, { status: p.status, outOfStock: p.tracksInventory && (p.totalInventory ?? 1) <= 0 });
  }
  return out;
}

/** Everything needed to judge the links in the given posts. */
export async function buildContext(admin: Admin, shop: string, posts: BlogPost[]): Promise<{ ctx: RefreshContext; skippedChecks: string[]; totalPosts: number | null }> {
  const info = await gql<{ shop: { primaryDomain: { host: string }; myshopifyDomain: string } }>(
    admin,
    `#graphql
    query RefreshShop { shop { primaryDomain { host } myshopifyDomain } }`,
  );
  const hosts = new Set([info.shop.primaryDomain.host.toLowerCase(), info.shop.myshopifyDomain.toLowerCase(), `www.${info.shop.primaryDomain.host.toLowerCase()}`]);
  const [{ paths, total }, collections, products, settings] = await Promise.all([
    loadPostPaths(admin),
    loadCollectionHandles(admin),
    loadProducts(admin, [...new Set(posts.flatMap((p) => productHandlesIn(p.body, hosts)))]),
    loadSettings(shop),
  ]);
  const skippedChecks: string[] = [];
  if (!collections) skippedChecks.push("collection links");
  if (total < 0) skippedChecks.push("links to other posts");
  const ctx: RefreshContext = {
    products,
    collections: collections ?? new Set<string>(),
    postPaths: paths,
    hosts,
    now: new Date(),
    rules: cleanRules(settings.refreshRules),
    skipCollections: !collections,
    skipPosts: total < 0,
  };
  return { ctx, skippedChecks, totalPosts: total < 0 ? null : total };
}

export async function isProtected(shop: string, post: BlogPost): Promise<boolean> {
  const rows = await db.refreshProtected.findMany({ where: { shop } });
  return rows.some((r) => (r.kind === "post" && r.ref === post.id.split("/").pop()) || (r.kind === "blog" && r.ref === post.blogHandle));
}

export type RefreshList = { reviews: PostReview[]; shown: number; totalPosts: number | null; skippedChecks: string[]; protectedCount: number };

export async function loadRefreshList(admin: Admin, shop: string, limit = 100): Promise<RefreshList> {
  const protectedRows = await db.refreshProtected.findMany({ where: { shop } });
  const isProt = (p: BlogPost) => protectedRows.some((r) => (r.kind === "post" && r.ref === p.id.split("/").pop()) || (r.kind === "blog" && r.ref === p.blogHandle));
  const all = await loadPosts(admin, limit);
  const posts = all.filter((p) => !isProt(p));
  const { ctx, skippedChecks, totalPosts } = await buildContext(admin, shop, posts);
  let reviews = posts.map((p) => analysePost(p, ctx));
  if (skippedChecks.length) {
    const drop = new Set([...(ctx.skipCollections ? ["collection_gone"] : []), ...(ctx.skipPosts ? ["post_gone"] : [])]);
    reviews = reviews.map((r) => {
      const lost = r.signals.filter((s) => drop.has(s.id)).reduce((n, s) => n + s.weight, 0);
      return { ...r, signals: r.signals.filter((s) => !drop.has(s.id)), priority: r.priority - lost };
    });
  }
  reviews.sort((a, b) => b.priority - a.priority || a.post.updatedAt.localeCompare(b.post.updatedAt));
  return { reviews, shown: reviews.length, totalPosts, skippedChecks, protectedCount: all.length - posts.length };
}

/** Published blog posts a link can be pointed at (newest first), for the "replace with a blog post" choice. */
export async function loadPostChoices(admin: Admin, excludeId: string): Promise<{ title: string; path: string }[]> {
  const d = await gql<{ articles: { nodes: { id: string; title: string; handle: string; isPublished: boolean; blog: { handle: string } }[] } }>(
    admin,
    `#graphql
    query PostChoices { articles(first: 100, sortKey: PUBLISHED_AT, reverse: true) { nodes { id title handle isPublished blog { handle } } } }`,
  );
  return d.articles.nodes.filter((a) => a.isPublished && a.id !== excludeId).map((a) => ({ title: a.title, path: `/blogs/${a.blog.handle}/${a.handle}` }));
}
