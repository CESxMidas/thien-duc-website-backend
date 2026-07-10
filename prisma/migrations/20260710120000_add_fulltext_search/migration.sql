-- Full-text search cho dự án + tin tức (YC-10).
--
-- Nội dung song ngữ nằm trong JSONB `{vi, en?}` nên không index thẳng cột được.
-- Gói biểu thức tsvector vào hàm IMMUTABLE để index GIN và câu truy vấn dùng
-- **đúng cùng một biểu thức** — nếu viết lặp bằng tay ở hai nơi, chỉ cần lệch
-- một dấu cách là planner bỏ qua index và quay về seq scan.
--
-- Dùng cấu hình 'simple' (không stemming): tiếng Việt không có ts config sẵn
-- trong PostgreSQL, và 'english' sẽ cắt gốc từ sai trên chuỗi tiếng Việt.

-- Dự án: title/summary/description song ngữ + category/location là text thuần.
CREATE OR REPLACE FUNCTION project_search_document(
  title JSONB,
  summary JSONB,
  description JSONB,
  category TEXT,
  location TEXT
) RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT to_tsvector(
    'simple',
    coalesce(title ->> 'vi', '') || ' ' || coalesce(title ->> 'en', '') || ' ' ||
    coalesce(summary ->> 'vi', '') || ' ' || coalesce(summary ->> 'en', '') || ' ' ||
    coalesce(description ->> 'vi', '') || ' ' || coalesce(description ->> 'en', '') || ' ' ||
    coalesce(category, '') || ' ' ||
    coalesce(location, '')
  );
$$;

-- Tin tức: `content` là mảng JSONB các đoạn `{vi, en?}`. Ép ::text giữ nguyên cả
-- hai ngôn ngữ; token thừa ("vi", "en") vô hại vì người dùng không tìm chúng.
CREATE OR REPLACE FUNCTION news_search_document(
  title JSONB,
  summary JSONB,
  content JSONB,
  author TEXT
) RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT to_tsvector(
    'simple',
    coalesce(title ->> 'vi', '') || ' ' || coalesce(title ->> 'en', '') || ' ' ||
    coalesce(summary ->> 'vi', '') || ' ' || coalesce(summary ->> 'en', '') || ' ' ||
    coalesce(content::text, '') || ' ' ||
    coalesce(author, '')
  );
$$;

CREATE INDEX IF NOT EXISTS "projects_search_idx"
  ON "projects"
  USING GIN (project_search_document("title", "summary", "description", "category", "location"));

CREATE INDEX IF NOT EXISTS "news_posts_search_idx"
  ON "news_posts"
  USING GIN (news_search_document("title", "summary", "content", "author"));

-- Lọc theo trạng thái luôn đi kèm truy vấn tìm kiếm (chỉ trả nội dung đã đăng).
CREATE INDEX IF NOT EXISTS "projects_content_status_idx" ON "projects" ("content_status");
CREATE INDEX IF NOT EXISTS "news_posts_status_idx" ON "news_posts" ("status");

-- Cron đăng bài theo lịch (ED-08) quét đúng các bài chưa đăng và đã tới hạn.
CREATE INDEX IF NOT EXISTS "news_posts_scheduled_at_idx"
  ON "news_posts" ("scheduled_at")
  WHERE "scheduled_at" IS NOT NULL AND "status" <> 'PUBLISHED';
