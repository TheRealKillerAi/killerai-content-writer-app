-- AlterTable
ALTER TABLE "Article" ADD COLUMN "keyword" TEXT,
ADD COLUMN "title" TEXT,
ADD COLUMN "sentAs" TEXT;

-- Fill in the new columns for articles that already exist
UPDATE "Article" SET
  "keyword" = ("angle"::json->>'target_query'),
  "title" = ("angle"::json->>'working_title'),
  "sentAs" = CASE
    WHEN "result" IS NULL THEN NULL
    WHEN ("result"::json->'sent'->>'published') = 'true' THEN 'live'
    WHEN ("result"::json->>'sent') IS NOT NULL THEN 'draft'
    ELSE NULL
  END;

-- CreateIndex
CREATE INDEX "Article_shop_keyword_idx" ON "Article"("shop", "keyword");
