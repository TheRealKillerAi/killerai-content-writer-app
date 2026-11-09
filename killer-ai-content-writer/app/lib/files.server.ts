import { gql, type Admin } from "./products.server";

const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type StagedTarget = { url: string; resourceUrl: string; parameters: { name: string; value: string }[] };

/** Step 1: ask Shopify where the browser can upload the picture. */
export async function stageImage(admin: Admin, filename: string, mimeType: string, fileSize: number): Promise<StagedTarget> {
  if (!TYPES.includes(mimeType)) throw new Error("Please choose a JPG, PNG, WebP or GIF picture.");
  if (!fileSize || fileSize > MAX_IMAGE_BYTES) throw new Error("That picture is too large. Please choose one under 10 MB.");
  const d = await gql<{
    stagedUploadsCreate: { stagedTargets: StagedTarget[]; userErrors: { message: string }[] };
  }>(
    admin,
    `#graphql
    mutation Stage($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { message }
      }
    }`,
    { input: [{ filename: filename.slice(0, 120) || "image", mimeType, resource: "IMAGE", httpMethod: "POST", fileSize: String(fileSize) }] },
  );
  const r = d.stagedUploadsCreate;
  if (r.userErrors.length || !r.stagedTargets[0]) throw new Error(r.userErrors[0]?.message || "Shopify couldn't prepare the upload.");
  return r.stagedTargets[0];
}

/** Step 3: add the uploaded picture to the store's Files and wait for its permanent address. */
export async function finishImage(admin: Admin, resourceUrl: string, alt: string): Promise<string> {
  const d = await gql<{
    fileCreate: { files: { id: string }[]; userErrors: { message: string }[] };
  }>(
    admin,
    `#graphql
    mutation Create($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id }
        userErrors { message }
      }
    }`,
    { files: [{ originalSource: resourceUrl, contentType: "IMAGE", alt: alt.slice(0, 500) }] },
  );
  const made = d.fileCreate;
  const id = made.files[0]?.id;
  if (made.userErrors.length || !id) throw new Error(made.userErrors[0]?.message || "Shopify couldn't save the picture.");
  for (let i = 0; i < 15; i++) {
    const f = await gql<{
      node: { fileStatus?: string; image?: { url: string } | null } | null;
    }>(
      admin,
      `#graphql
      query FileReady($id: ID!) {
        node(id: $id) { ... on MediaImage { fileStatus image { url } } }
      }`,
      { id },
    );
    if (f.node?.fileStatus === "FAILED") throw new Error("Shopify couldn't process that picture. Try a different one.");
    if (f.node?.image?.url) return f.node.image.url;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Shopify is still processing the picture. Please try again in a moment.");
}
