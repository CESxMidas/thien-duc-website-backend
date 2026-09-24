ALTER TABLE "project_items" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "project_gallery" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "news_categories" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "media_assets" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
