-- CreateTable
CREATE TABLE "ScheduleStatus" (
    "shop" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleStatus_pkey" PRIMARY KEY ("shop")
);

-- Row level security (the app connects as the table owner)
ALTER TABLE "ScheduleStatus" ENABLE ROW LEVEL SECURITY;
