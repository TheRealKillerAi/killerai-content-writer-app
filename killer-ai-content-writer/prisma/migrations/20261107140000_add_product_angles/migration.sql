-- CreateTable
CREATE TABLE "ProductAngles" (
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "angles" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("shop", "productId")
);
