/*
  Warnings:

  - You are about to drop the `AppSetting` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "AppSetting";

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);
