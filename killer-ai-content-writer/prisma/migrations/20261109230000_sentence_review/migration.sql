-- CreateTable
CREATE TABLE "SentenceReview" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "sentence" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "decidedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentenceReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SentenceReview_shop_articleId_idx" ON "SentenceReview"("shop", "articleId");

-- CreateIndex
CREATE INDEX "SentenceReview_shop_decision_key_idx" ON "SentenceReview"("shop", "decision", "key");
ALTER TABLE "SentenceReview" ENABLE ROW LEVEL SECURITY;
