-- CreateTable
CREATE TABLE "Author" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'real',
    "name" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL DEFAULT '',
    "bio" TEXT NOT NULL DEFAULT '',
    "profileUrl" TEXT NOT NULL DEFAULT '',
    "photoUrl" TEXT NOT NULL DEFAULT '',
    "photoAlt" TEXT NOT NULL DEFAULT '',
    "voice" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Author_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Author_shop_idx" ON "Author"("shop");

-- Row level security (the app connects as the table owner)
ALTER TABLE "Author" ENABLE ROW LEVEL SECURITY;
