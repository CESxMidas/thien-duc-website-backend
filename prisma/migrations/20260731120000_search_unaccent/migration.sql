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

-- ⚠️ BẮT BUỘC SCHEMA-QUALIFY MỌI LỜI GỌI HÀM Ở ĐÂY.
-- Hàm `LANGUAGE sql` lưu thân dưới dạng VĂN BẢN; tên bên trong chỉ được phân
-- giải lúc **inlining**, dùng `search_path` CỦA PHIÊN GỌI chứ không phải của
-- lúc `CREATE FUNCTION`. Bản đầu của migration này gọi `immutable_unaccent(...)`
-- không qualify, nên `CREATE INDEX` chỉ chạy được khi `search_path` tình cờ có
-- schema chứa hàm bọc. CI (PostgreSQL 17) đổ đúng ở đó:
--     P3018 / 42883  function immutable_unaccent(text) does not exist
--     SQL function "project_search_document" during inlining
-- Đã tái hiện được cơ chế cục bộ: cùng thân hàm, chỉ đổi `search_path` là lỗi
-- hiện ra. Qualify đầy đủ thì `CREATE INDEX` chạy được với MỌI `search_path`,
-- kể cả `search_path = ''` (đã đo).
--
-- Schema `public` suy ra từ chính cấu hình Prisma: `schema.prisma` không bật
-- multiSchema, không có `@@schema`, và CI đặt `?schema=public`.

-- 1) Bật extension, ghim vào schema `public` để mọi tham chiếu
--    `public.unaccent` bên dưới luôn đúng. `IF NOT EXISTS` cho phép chạy lại.
--    CẦN quyền tạo extension (unaccent nằm trong contrib).
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

-- 2) Hàm bọc IMMUTABLE để dùng được trong biểu thức index. Tạo TRƯỚC mọi hàm
--    phụ thuộc, và đặt tên có schema tường minh.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(input TEXT)
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
CREATE OR REPLACE FUNCTION public.project_search_document(
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
    public.immutable_unaccent(
      coalesce(title ->> 'vi', '') || ' ' || coalesce(title ->> 'en', '') || ' ' ||
      coalesce(summary ->> 'vi', '') || ' ' || coalesce(summary ->> 'en', '') || ' ' ||
      coalesce(description ->> 'vi', '') || ' ' || coalesce(description ->> 'en', '') || ' ' ||
      coalesce(category ->> 'vi', '') || ' ' || coalesce(category ->> 'en', '') || ' ' ||
      coalesce(location ->> 'vi', '') || ' ' || coalesce(location ->> 'en', '')
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.news_search_document(
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
    public.immutable_unaccent(
      coalesce(title ->> 'vi', '') || ' ' || coalesce(title ->> 'en', '') || ' ' ||
      coalesce(summary ->> 'vi', '') || ' ' || coalesce(summary ->> 'en', '') || ' ' ||
      coalesce(content::text, '') || ' ' ||
      coalesce(author, '')
    )
  );
$$;

-- 5) Dựng lại index GIN theo biểu thức MỚI. Qualify luôn tên hàm ngoài: tên
--    trong CÂU LỆNH được phân giải lúc parse (search_path bình thường) nên vốn
--    vẫn chạy, nhưng qualify hết thì không còn phụ thuộc `search_path` ở bất kỳ
--    tầng nào — đó chính là thứ đã làm CI đỏ.
CREATE INDEX IF NOT EXISTS "projects_search_idx"
  ON "projects"
  USING GIN (public.project_search_document("title", "summary", "description", "category", "location"));

CREATE INDEX IF NOT EXISTS "news_posts_search_idx"
  ON "news_posts"
  USING GIN (public.news_search_document("title", "summary", "content", "author"));
