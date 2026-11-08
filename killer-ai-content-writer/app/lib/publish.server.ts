import { gql, type Admin } from "./products.server";
import { buildBodyHtml, esc, safeHandle } from "./articleHtml";
import type { AppSettings } from "./settings";
import type { Angle, Article, SentInfo } from "./pipeline/types";

export class PublishError extends Error {}

type UserError = { field?: string[] | null; message: string };
type ArticleNode = { id: string; handle: string; isPublished: boolean; blog: { handle: string } };

const ARTICLE_FIELDS = `id handle isPublished blog { handle }`;

async function storefrontUrl(admin: Admin, blogHandle: string, handle: string): Promise<string | null> {
  try {
    const d = await gql<{ shop: { primaryDomain: { url: string } } }>(
      admin,
      `#graphql\n      query Domain { shop { primaryDomain { url } } }`,
    );
    return `${d.shop.primaryDomain.url.replace(/\/$/, "")}/blogs/${blogHandle}/${handle}`;
  } catch {
    return null;
  }
}

export async function sendToShopify(
  admin: Admin,
  opts: {
    article: Article;
    angle: Angle;
    productHandle: string;
    settings: AppSettings;
    shopName: string;
    publish: boolean;
    existing?: SentInfo | null;
  },
): Promise<{ sent: SentInfo; warning?: string }> {
  const { article: a, angle, settings, publish, existing } = opts;
  const handle = safeHandle(a.handle, a.h1);
  const org = a.organization;
  const tagList = org
    ? org.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : settings.keywordsAsTags && angle.target_query
      ? [angle.target_query]
      : [];
  const template = (org ? org.templateSuffix : settings.articleTemplate).trim();
  const chosenBlog = [org?.blogId, settings.blogId].find((b) => b?.startsWith("gid://shopify/Blog/")) ?? "";
  const base = {
    title: a.h1,
    handle,
    body: buildBodyHtml(a, opts.productHandle, settings.toc, settings),
    summary: `<p>${esc(a.excerpt?.trim() || a.tldr)}</p>`,
    ...(a.featured_image?.url ? { image: { url: a.featured_image.url, altText: a.featured_image.alt || a.h1 } } : {}),
    author: { name: org?.author.trim() || settings.defaultAuthor.trim() || opts.shopName || "Editor" },
    tags: tagList,
    ...(template ? { templateSuffix: template } : {}),
  };
  const seo = [
    { namespace: "global", key: "title_tag", type: "single_line_text_field", value: a.title_tag },
    { namespace: "global", key: "description_tag", type: "single_line_text_field", value: a.meta_description },
  ];

  const run = async (withSeo: boolean) => {
    if (existing) {
      const d = await gql<{ articleUpdate: { article: ArticleNode | null; userErrors: UserError[] } }>(
        admin,
        `#graphql
        mutation Update($id: ID!, $article: ArticleUpdateInput!) {
          articleUpdate(id: $id, article: $article) { article { ${ARTICLE_FIELDS} } userErrors { field message } }
        }`,
        { id: existing.id, article: { ...base, ...(chosenBlog ? { blogId: chosenBlog } : {}), redirectNewHandle: true, ...(withSeo ? { metafields: seo } : {}) } },
      );
      return d.articleUpdate;
    }
    // Resolve the blog: the chosen one, else the first, else create a default blog.
    let blogId = chosenBlog;
    if (!blogId) {
      const b = await gql<{ blogs: { nodes: { id: string }[] } }>(
        admin,
        `#graphql\n        query FirstBlog { blogs(first: 1) { nodes { id } } }`,
      );
      blogId = b.blogs.nodes[0]?.id ?? "";
    }
    const d = await gql<{ articleCreate: { article: ArticleNode | null; userErrors: UserError[] } }>(
      admin,
      `#graphql
      mutation Create($article: ArticleCreateInput!, $blog: ArticleBlogInput) {
        articleCreate(article: $article, blog: $blog) { article { ${ARTICLE_FIELDS} } userErrors { field message } }
      }`,
      {
        article: { ...base, ...(blogId ? { blogId } : {}), isPublished: publish, ...(withSeo ? { metafields: seo } : {}) },
        ...(blogId ? {} : { blog: { title: "News" } }),
      },
    );
    return d.articleCreate;
  };

  let result = await run(true);
  let warning: string | undefined;
  if (!result.article && result.userErrors.some((e) => /metafield/i.test(e.message + (e.field ?? []).join(" ")))) {
    result = await run(false);
    warning = "We couldn't set the search title and description in Shopify, so please check them there.";
  }
  if (!result.article) {
    const msg = result.userErrors.map((e) => e.message).join(" ") || "Shopify didn't accept the article.";
    throw new PublishError(msg);
  }
  const art = result.article;
  const url = await storefrontUrl(admin, art.blog.handle, art.handle);
  return {
    sent: { id: art.id, published: art.isPublished, at: new Date().toISOString(), handle: art.handle, blogHandle: art.blog.handle, url },
    warning,
  };
}
