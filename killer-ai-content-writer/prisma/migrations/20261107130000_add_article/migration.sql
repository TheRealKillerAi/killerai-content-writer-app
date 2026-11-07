-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'writing',
    "stage" TEXT NOT NULL DEFAULT 'Starting',
    "result" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Article_shop_productId_idx" ON "Article"("shop", "productId");
