import type { ProductFacts } from "./pipeline/types";

export type Admin = { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> };

export async function gql<T>(admin: Admin, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await admin.graphql(query, { variables });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e: { message: string }) => e.message).join("; "));
  return body.data as T;
}

export type ProductRow = {
  id: string;
  title: string;
  status: string;
  vendor: string;
  productType: string;
  imageUrl: string | null;
};

export async function listProducts(admin: Admin, search: string, after?: string | null) {
  const data = await gql<{
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: {
        id: string; title: string; status: string; vendor: string; productType: string;
        featuredMedia: { preview: { image: { url: string } | null } | null } | null;
      }[];
    };
  }>(
    admin,
    `#graphql
    query Products($query: String, $after: String) {
      products(first: 20, query: $query, after: $after, sortKey: UPDATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id title status vendor productType
          featuredMedia { preview { image { url } } }
        }
      }
    }`,
    { query: search || null, after: after || null },
  );
  return {
    pageInfo: data.products.pageInfo,
    products: data.products.nodes.map<ProductRow>((p) => ({
      id: p.id, title: p.title, status: p.status, vendor: p.vendor, productType: p.productType,
      imageUrl: p.featuredMedia?.preview?.image?.url ?? null,
    })),
  };
}

const UNITS: Record<string, string> = { KILOGRAMS: "kg", GRAMS: "g", POUNDS: "lb", OUNCES: "oz" };
function variantWeights(variants: { title: string; inventoryItem: { measurement: { weight: { value: number; unit: string } | null } | null } | null }[]) {
  const out: { variant: string; weight: string }[] = [];
  for (const v of variants) {
    const w = v.inventoryItem?.measurement?.weight;
    if (!w || !w.value) continue;
    out.push({ variant: /^default title$/i.test(v.title) ? "" : v.title, weight: `${w.value} ${UNITS[w.unit] ?? w.unit.toLowerCase()}` });
  }
  return out.slice(0, 20);
}

const SKIP_NAMESPACES = /^(global|shopify--discovery.*|mm-google-shopping|reviews|instant_search|seo|judgeme|yotpo|stamped|loox|ali_reviews)$/i;
const SKIP_TYPES = /reference|file|json|rich_text|^id$|url|link/i;
/** Readable custom product fields (size, material, care...). Skips SEO, review-app and reference fields. */
function productDetails(nodes: { namespace: string; key: string; type: string; value: string; definition: { name: string } | null }[]) {
  const out: { name: string; value: string }[] = [];
  for (const m of nodes) {
    if (SKIP_NAMESPACES.test(m.namespace) || SKIP_TYPES.test(m.type) || !m.value?.trim()) continue;
    let value = m.value.trim();
    if (m.type.startsWith("list.")) {
      try {
        const arr = JSON.parse(value);
        if (Array.isArray(arr)) value = arr.map((x) => (typeof x === "object" && x ? [x.value, x.unit].filter(Boolean).join(" ") : String(x))).join(", ");
      } catch { /* keep raw */ }
    } else if (/^(dimension|weight|volume)$/.test(m.type)) {
      try {
        const o = JSON.parse(value);
        value = `${o.value} ${String(o.unit).toLowerCase()}`;
      } catch { /* keep raw */ }
    }
    if (value.length > 600) continue;
    out.push({ name: m.definition?.name ?? m.key.replace(/[_-]+/g, " "), value });
  }
  return out.slice(0, 30);
}

export async function getProduct(admin: Admin, id: string) {
  const data = await gql<{
    product: {
      id: string; title: string; handle: string; status: string; vendor: string; productType: string;
      tags: string[]; descriptionHtml: string;
      category: { fullName: string } | null;
      metafields: { nodes: { namespace: string; key: string; type: string; value: string; definition: { name: string } | null }[] };
      variants: { nodes: { title: string; inventoryItem: { measurement: { weight: { value: number; unit: string } | null } | null } | null }[] };
      options: { name: string; values: string[] }[];
      featuredMedia: { preview: { image: { url: string } | null } | null } | null;
    } | null;
  }>(
    admin,
    `#graphql
    query Product($id: ID!) {
      product(id: $id) {
        id title handle status vendor productType tags descriptionHtml
        category { fullName }
        metafields(first: 40) { nodes { namespace key type value definition { name } } }
        variants(first: 50) { nodes { title inventoryItem { measurement { weight { value unit } } } } }
        options { name values }
        featuredMedia { preview { image { url } } }
      }
    }`,
    { id },
  );
  const p = data.product;
  if (!p) return null;
  const facts: ProductFacts = {
    title: p.title, handle: p.handle, vendor: p.vendor, productType: p.productType,
    tags: p.tags, options: p.options.filter((o) => o.name !== "Title"), description_html: p.descriptionHtml,
    category: p.category?.fullName,
    variant_weights: variantWeights(p.variants.nodes),
    details: productDetails(p.metafields.nodes),
  };
  return { id: p.id, status: p.status, imageUrl: p.featuredMedia?.preview?.image?.url ?? null, facts };
}

export async function existingArticleTitles(admin: Admin): Promise<string[]> {
  try {
    const data = await gql<{ articles: { nodes: { title: string }[] } }>(
      admin,
      `#graphql
      query ExistingArticles { articles(first: 50) { nodes { title } } }`,
    );
    return data.articles.nodes.map((a) => a.title);
  } catch {
    return []; // not fatal: angles still work, just without overlap checking
  }
}

export async function productTitles(admin: Admin, productIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(productIds)].slice(0, 100).map((id) => `gid://shopify/Product/${id}`);
  if (!ids.length) return {};
  try {
    const data = await gql<{ nodes: ({ id: string; title: string } | null)[] }>(
      admin,
      `#graphql
      query Titles($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title } } }`,
      { ids },
    );
    const out: Record<string, string> = {};
    for (const n of data.nodes) if (n) out[n.id.split("/").pop()!] = n.title;
    return out;
  } catch {
    return {};
  }
}

export type BlogRow = { id: string; title: string; handle: string };

export async function primaryDomain(admin: Admin): Promise<string> {
  try {
    const d = await gql<{ shop: { primaryDomain: { url: string } } }>(
      admin,
      `#graphql\n      query Domain { shop { primaryDomain { url } } }`,
    );
    return d.shop.primaryDomain.url.replace(/\/$/, "");
  } catch {
    return "";
  }
}

export async function listBlogs(admin: Admin): Promise<BlogRow[]> {
  try {
    const data = await gql<{ blogs: { nodes: BlogRow[] } }>(
      admin,
      `#graphql
      query Blogs { blogs(first: 20) { nodes { id title handle } } }`,
    );
    return data.blogs.nodes;
  } catch {
    return [];
  }
}

/** Plain text of the store's most recent blog articles, used to learn the brand voice. */
export async function recentArticleTexts(admin: Admin, count = 6): Promise<string[]> {
  try {
    const data = await gql<{ articles: { nodes: { title: string; body: string }[] } }>(
      admin,
      `#graphql
      query Recent($n: Int!) { articles(first: $n, sortKey: PUBLISHED_AT, reverse: true) { nodes { title body } } }`,
      { n: count },
    );
    return data.articles.nodes
      .map((a) => `${a.title}\n${a.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`.slice(0, 3500))
      .filter((t) => t.length > 300);
  } catch {
    return [];
  }
}

export async function getShopName(admin: Admin): Promise<string> {
  try {
    const data = await gql<{ shop: { name: string } }>(admin, `#graphql\n      query ShopName { shop { name } }`);
    return data.shop.name ?? "";
  } catch {
    return "";
  }
}

export type ProductImage = { url: string; alt: string };

export async function productImages(admin: Admin, productId: string): Promise<ProductImage[]> {
  try {
    const d = await gql<{ product: { media: { nodes: { image?: { url: string; altText: string | null } | null }[] } } | null }>(
      admin,
      `#graphql
      query ProductImages($id: ID!) {
        product(id: $id) { media(first: 12) { nodes { ... on MediaImage { image { url altText } } } } }
      }`,
      { id: productId },
    );
    return (d.product?.media.nodes ?? []).flatMap((n) => (n.image ? [{ url: n.image.url, alt: n.image.altText ?? "" }] : []));
  } catch {
    return [];
  }
}
