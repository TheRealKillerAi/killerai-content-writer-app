-- CreateTable
CREATE TABLE "MerchantFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "unknown" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "MerchantFact_shop_productId_idx" ON "MerchantFact"("shop", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantFact_shop_productId_question_key" ON "MerchantFact"("shop", "productId", "question");
