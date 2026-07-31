-- Tìm kiếm BỎ DẤU tiếng Việt (backlog §6 / YC-10).
--
-- VẤN ĐỀ: hai hàm `*_search_document` dựng tsvector bằng `to_tsvector('simple', …)`
-- trên chuỗi NGUYÊN VĂN, nên "du an" KHÔNG khớp "Dự án" (đã đo được: false).
-- Người Việt gõ không dấu là thói quen phổ biến ⇒ tìm kiếm thường ra rỗng.
--
-- CÁCH SỬA: bọc `unaccent()` ở CẢ HAI phía — lúc dựng tsvector (migration này)
-- và lúc dựng tsquery (`search.service.ts`). Bọc một phía là vô nghĩa.
--
-- TẠI SAO CẦN HÀM BỌC `immutable_unaccent`:
-- `unaccent(text)` một tham số là STABLE, KHÔNG phải IMMUTABLE (nó phụ thuộc
-- `search_path` để tìm dictionary), mà biểu thức index BẮT BUỘC phải IMMUTABLE.
-- Dạng hai tham số `unaccent(regdictionary, text)` không có ràng buộc đó, nên ta
-- bọc lại và khai báo IMMUTABLE — đây là cách chính thức PostgreSQL khuyến nghị.
-- Tên dictionary được ghi rõ schema (`public.unaccent`) để không phụ thuộc
-- `search_path` của phiên gọi.

-- 1) Bật extension. `IF NOT EXISTS` để migration chạy lại được (idempotent).
--    CẦN quyền tạo extension. Render Postgres cho phép các extension contrib
--    (unaccent nằm trong contrib) — xem ghi chú vận hành trong deployment docs.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 2) Hàm bọc IMMUTABLE để dùng được trong biểu thức index.
CREATE OR REPLACE FUNCTION immutable_unaccent(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, input);
$$;

-- 3) Gỡ index TRƯỚC khi đổi thân hàm. `CREATE OR REPLACE FUNCTION` không tự
--    dựng lại index đã xây theo thân hàm cũ — để nguyên sẽ có index lệch dữ
--    liệu, tìm kiếm trả kết quả sai một cách âm thầm.
DROP INDEX IF EXISTS "projects_search_idx";
DROP INDEX IF EXISTS "news_posts_search_idx";

-- 4) Dựng lại hai hàm, bọc `immutable_unaccent` quanh chuỗi đã ghép.
CREATE OR REPLACE FUNCTION project_search_document(
  title JSONB,
  summary JSONB,
  description JSONB,
  category JSONB,
  location JSONB
) RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT to_tsvector(
    'simple',
    immutable_unaccent(
      coalesce(title ->> 'vi', '') || ' ' || coalesce(title ->> 'en', '') || ' ' ||
      coalesce(summary ->> 'vi', '') || ' ' || coalesce(summary ->> 'en', '') || ' ' ||
      coalesce(description ->> 'vi', '') || ' ' || coalesce(description ->> 'en', '') || ' ' ||
      coalesce(category ->> 'vi', '') || ' ' || coalesce(category ->> 'en', '') || ' ' ||
      coalesce(location ->> 'vi', '') || ' ' || coalesce(location ->> 'en', '')
    )
  );
$$;

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
    immutable_unaccent(
      coalesce(title ->> 'vi', '') || ' ' || coalesce(title ->> 'en', '') || ' ' ||
      coalesce(summary ->> 'vi', '') || ' ' || coalesce(summary ->> 'en', '') || ' ' ||
      coalesce(content::text, '') || ' ' ||
      coalesce(author, '')
    )
  );
$$;

-- 5) Dựng lại index GIN theo biểu thức MỚI.
CREATE INDEX IF NOT EXISTS "projects_search_idx"
  ON "projects"
  USING GIN (project_search_document("title", "summary", "description", "category", "location"));

CREATE INDEX IF NOT EXISTS "news_posts_search_idx"
  ON "news_posts"
  USING GIN (news_search_document("title", "summary", "content", "author"));
