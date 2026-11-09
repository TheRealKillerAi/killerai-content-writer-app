import { gql, type Admin } from "./products.server";

/** Turns a file picked in Shopify's own file picker into the picture's web address. */
export async function pickedImage(admin: Admin, ids: string[]): Promise<{ url: string; alt: string }> {
  const id = ids.find((i) => /^gid:\/\/shopify\/MediaImage\//.test(i)) ?? ids[0];
  if (!id) throw new Error("No picture was chosen.");
  const d = await gql<{ node: { image?: { url: string; altText?: string | null } | null; alt?: string | null } | null }>(
    admin,
    `#graphql
    query PickedFile($id: ID!) {
      node(id: $id) { ... on MediaImage { alt image { url altText } } }
    }`,
    { id },
  );
  const url = d.node?.image?.url;
  if (!url) throw new Error("That file isn't a picture yet. If you just uploaded it, give Shopify a moment and try again.");
  return { url, alt: (d.node?.alt || d.node?.image?.altText || "").trim() };
}
