-- CreateTable
CREATE TABLE "RefreshRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "articleTitle" TEXT NOT NULL,
    "handle" TEXT NOT NULL DEFAULT '',
    "bodyBefore" TEXT,
    "bodyAfter" TEXT,
    "wordsBefore" INTEGER NOT NULL,
    "wordsAfter" INTEGER NOT NULL,
    "seoBefore" INTEGER NOT NULL,
    "seoAfter" INTEGER NOT NULL,
    "aiBefore" INTEGER NOT NULL,
    "aiAfter" INTEGER NOT NULL,
    "appliedBy" TEXT NOT NULL DEFAULT '',
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "RefreshRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshChange" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "before" TEXT NOT NULL,
    "after" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "decision" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshProtected" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshProtected_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RefreshRun_shop_articleId_idx" ON "RefreshRun"("shop", "articleId");

-- CreateIndex
CREATE INDEX "RefreshRun_appliedAt_idx" ON "RefreshRun"("appliedAt");

-- CreateIndex
CREATE INDEX "RefreshChange_shop_articleId_idx" ON "RefreshChange"("shop", "articleId");

-- CreateIndex
CREATE INDEX "RefreshChange_runId_idx" ON "RefreshChange"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshProtected_shop_kind_ref_key" ON "RefreshProtected"("shop", "kind", "ref");

-- AddForeignKey
ALTER TABLE "RefreshChange" ADD CONSTRAINT "RefreshChange_runId_fkey" FOREIGN KEY ("runId") REFERENCES "RefreshRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RefreshRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshProtected" ENABLE ROW LEVEL SECURITY;
