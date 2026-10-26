-- Bài cũ cùng thứ tự 0; khóa phụ created_at DESC ưu tiên nội dung mới.
ALTER TABLE "news_posts" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "news_posts_order_created_at_id_idx" ON "news_posts" ("order", "created_at" DESC, "id" DESC);
