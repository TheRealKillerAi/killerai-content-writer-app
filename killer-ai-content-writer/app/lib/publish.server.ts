import { gql, type Admin } from "./products.server";
import { renderMarkdown, tocEntries } from "./markdown";
import type { AppSettings } from "./settings";
import type { Angle, Article, SentInfo } from "./pipeline/types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildBodyHtml(a: Article, productHandle: string, toc: boolean): string {
  const productUrl = `/products/${productHandle}`;
  const parts: string[] = [`<p><strong>TL;DR:</strong> ${esc(a.tldr)}</p>`];
  const entries = toc ? tocEntries(a.body_markdown) : [];
  if (entries.length >= 3) {
    parts.push(
      `<p><strong>In this article</strong></p>\n<ul>${entries
        .map((e) => `<li><a href="#${e.id}">${esc(e.text)}</a></li>`)
        .join("")}</ul>`,
    );
  }
  parts.push(renderMarkdown(a.body_markdown, productUrl, entries.length >= 3));
  if (a.faq.length) {
    parts.push(
      `<h2>Frequently asked questions</h2>`,
      ...a.faq.map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`),
    );
  }
  return parts.join("\n");
}

const safeHandle = (h: string, fallback: string) =>
  (h || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "article";

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
  const base = {
    title: a.h1,
    handle,
    body: buildBodyHtml(a, opts.productHandle, settings.toc),
    summary: `<p>${esc(a.meta_description)}</p>`,
    author: { name: settings.defaultAuthor.trim() || opts.shopName || "Editor" },
    tags: settings.keywordsAsTags && angle.target_query ? [angle.target_query] : [],
    ...(settings.articleTemplate.trim() ? { templateSuffix: settings.articleTemplate.trim() } : {}),
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
        { id: existing.id, article: { ...base, redirectNewHandle: true, ...(withSeo ? { metafields: seo } : {}) } },
      );
      return d.articleUpdate;
    }
    // Resolve the blog: the chosen one, else the first, else create a default blog.
    let blogId = settings.blogId.startsWith("gid://shopify/Blog/") ? settings.blogId : "";
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
  const url = art.isPublished ? await storefrontUrl(admin, art.blog.handle, art.handle) : null;
  return {
    sent: { id: art.id, published: art.isPublished, at: new Date().toISOString(), handle: art.handle, blogHandle: art.blog.handle, url },
    warning,
  };
}
