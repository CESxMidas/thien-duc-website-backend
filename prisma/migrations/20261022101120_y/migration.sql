/*
  Warnings:

  - The values [ARCHIVED] on the enum `ContentStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ContentStatus_new" AS ENUM ('DRAFT', 'PENDING', 'PUBLISHED');
ALTER TABLE "public"."cooperation_projects" ALTER COLUMN "content_status" DROP DEFAULT;
ALTER TABLE "public"."news_posts" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."pages" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."projects" ALTER COLUMN "content_status" DROP DEFAULT;
ALTER TABLE "public"."recruitment_positions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "projects" ALTER COLUMN "content_status" TYPE "ContentStatus_new" USING ("content_status"::text::"ContentStatus_new");
ALTER TABLE "news_posts" ALTER COLUMN "status" TYPE "ContentStatus_new" USING ("status"::text::"ContentStatus_new");
ALTER TABLE "pages" ALTER COLUMN "status" TYPE "ContentStatus_new" USING ("status"::text::"ContentStatus_new");
ALTER TABLE "recruitment_positions" ALTER COLUMN "status" TYPE "ContentStatus_new" USING ("status"::text::"ContentStatus_new");
ALTER TABLE "cooperation_projects" ALTER COLUMN "content_status" TYPE "ContentStatus_new" USING ("content_status"::text::"ContentStatus_new");
ALTER TYPE "ContentStatus" RENAME TO "ContentStatus_old";
ALTER TYPE "ContentStatus_new" RENAME TO "ContentStatus";
DROP TYPE "public"."ContentStatus_old";
ALTER TABLE "cooperation_projects" ALTER COLUMN "content_status" SET DEFAULT 'DRAFT';
ALTER TABLE "news_posts" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
ALTER TABLE "pages" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
ALTER TABLE "projects" ALTER COLUMN "content_status" SET DEFAULT 'DRAFT';
ALTER TABLE "recruitment_positions" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;
