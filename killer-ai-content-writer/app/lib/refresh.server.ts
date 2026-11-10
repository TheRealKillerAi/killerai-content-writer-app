import { gql, type Admin } from "./products.server";
import { analysePost, productHandlesIn, type BlogPost, type PostReview, type RefreshContext } from "./refresh";

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

const POSTS_QUERY = `#graphql
  query RefreshPosts($first: Int!, $after: String) {
    articles(first: $first, after: $after, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title handle body summary isPublished publishedAt updatedAt
        blog { handle title }
        author { name }
        image { url altText }
        titleTag: metafield(namespace: "global", key: "title_tag") { value }
        descriptionTag: metafield(namespace: "global", key: "description_tag") { value }
      }
    }
  }`;

/** The published posts that were updated longest ago, oldest first. */
async function loadPosts(admin: Admin, limit: number): Promise<BlogPost[]> {
  const out: BlogPost[] = [];
  let after: string | null = null;
  for (let page = 0; page < 3 && out.length < limit; page++) {
    const d: { articles: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: PostNode[] } } = await gql(admin, POSTS_QUERY, { first: 50, after });
    for (const n of d.articles.nodes) {
      if (!n.isPublished) continue;
      out.push({
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
      });
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

export type RefreshList = { reviews: PostReview[]; shown: number; totalPosts: number | null; skippedChecks: string[] };

export async function loadRefreshList(admin: Admin, limit = 100): Promise<RefreshList> {
  const shop = await gql<{ shop: { primaryDomain: { host: string }; myshopifyDomain: string } }>(
    admin,
    `#graphql
    query RefreshShop { shop { primaryDomain { host } myshopifyDomain } }`,
  );
  const hosts = new Set([shop.shop.primaryDomain.host.toLowerCase(), shop.shop.myshopifyDomain.toLowerCase(), `www.${shop.shop.primaryDomain.host.toLowerCase()}`]);
  const posts = await loadPosts(admin, limit);
  const skippedChecks: string[] = [];
  const [{ paths, total }, collections, products] = await Promise.all([
    loadPostPaths(admin),
    loadCollectionHandles(admin),
    loadProducts(admin, [...new Set(posts.flatMap((p) => productHandlesIn(p.body, hosts)))]),
  ]);
  // If we could not read every collection or post, don't claim a link is dead.
  const ctx: RefreshContext = {
    products,
    collections: collections ?? new Set<string>(),
    postPaths: paths,
    hosts,
    now: new Date(),
  };
  let reviews = posts.map((p) => analysePost(p, ctx));
  if (!collections) skippedChecks.push("collection links");
  if (total < 0) skippedChecks.push("links to other posts");
  if (skippedChecks.length) {
    const drop = new Set([...(collections ? [] : ["collection_gone"]), ...(total < 0 ? ["post_gone"] : [])]);
    reviews = reviews.map((r) => {
      const lost = r.signals.filter((s) => drop.has(s.id)).reduce((n, s) => n + s.weight, 0);
      return { ...r, signals: r.signals.filter((s) => !drop.has(s.id)), priority: r.priority - lost };
    });
  }
  reviews.sort((a, b) => b.priority - a.priority || a.post.updatedAt.localeCompare(b.post.updatedAt));
  return { reviews, shown: reviews.length, totalPosts: total < 0 ? null : total, skippedChecks };
}
