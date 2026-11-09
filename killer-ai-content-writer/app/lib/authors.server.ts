import db from "../db.server";

export type AuthorInput = {
  kind: "real" | "persona";
  name: string;
  jobTitle: string;
  bio: string;
  profileUrl: string;
  photoUrl: string;
  photoAlt: string;
  voice: string;
};

export const listAuthors = (shop: string) => db.author.findMany({ where: { shop }, orderBy: { createdAt: "asc" } });

export const getAuthor = (shop: string, id: string) => db.author.findFirst({ where: { id, shop } });

export const deleteAuthor = (shop: string, id: string) => db.author.deleteMany({ where: { id, shop } });

const text = (f: FormData, k: string, max: number) => String(f.get(k) ?? "").trim().slice(0, max);

export function authorFromForm(f: FormData): AuthorInput {
  const link = text(f, "profileUrl", 300);
  const photo = text(f, "photoUrl", 600);
  return {
    kind: f.get("kind") === "persona" ? "persona" : "real",
    name: text(f, "name", 80),
    jobTitle: text(f, "jobTitle", 80),
    bio: text(f, "bio", 800),
    profileUrl: /^https?:\/\//i.test(link) ? link : "",
    photoUrl: /^https:\/\//i.test(photo) ? photo : "",
    photoAlt: text(f, "photoAlt", 160),
    voice: text(f, "voice", 1200),
  };
}

export async function saveAuthor(shop: string, id: string | null, input: AuthorInput) {
  if (id) {
    const own = await getAuthor(shop, id);
    if (own) return db.author.update({ where: { id }, data: input });
  }
  return db.author.create({ data: { ...input, shop } });
}
