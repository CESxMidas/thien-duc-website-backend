-- EN-FULL-C2: chuyển Project.location & Project.category từ text sang JSONB song
-- ngữ `{ vi, en? }` (giống title/summary/description). Dữ liệu cũ là tiếng Việt
-- nên được gói vào `{ "vi": <giá trị cũ> }`, KHÔNG mất mát; NULL giữ NULL.
--
-- Vướng phụ thuộc full-text search: index `projects_search_idx` và hàm
-- `project_search_document(..., category TEXT, location TEXT)` đọc hai cột này
-- dạng text. Phải gỡ index + hàm, đổi kiểu cột, rồi tạo lại hàm nhận JSONB
-- (đọc `->>'vi'` và `->>'en'`) và dựng lại index. Truy vấn ở
-- `search.service.ts` truyền thẳng tên cột nên không phải sửa.

-- 1) Gỡ index phụ thuộc hàm cũ.
DROP INDEX IF EXISTS "projects_search_idx";

-- 2) Gỡ hàm cũ (chữ ký text) để có thể tạo lại với chữ ký JSONB.
DROP FUNCTION IF EXISTS project_search_document(JSONB, JSONB, JSONB, TEXT, TEXT);

-- 3) Đổi kiểu cột text -> jsonb, gói giá trị cũ vào { "vi": ... }.
ALTER TABLE "projects"
  ALTER COLUMN "location" TYPE JSONB
  USING (CASE WHEN "location" IS NULL THEN NULL ELSE jsonb_build_object('vi', "location") END);

ALTER TABLE "projects"
  ALTER COLUMN "category" TYPE JSONB
  USING (CASE WHEN "category" IS NULL THEN NULL ELSE jsonb_build_object('vi', "category") END);

-- 4) Tạo lại hàm search: category/location giờ là JSONB song ngữ.
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
    coalesce(title ->> 'vi', '') || ' ' || coalesce(title ->> 'en', '') || ' ' ||
    coalesce(summary ->> 'vi', '') || ' ' || coalesce(summary ->> 'en', '') || ' ' ||
    coalesce(description ->> 'vi', '') || ' ' || coalesce(description ->> 'en', '') || ' ' ||
    coalesce(category ->> 'vi', '') || ' ' || coalesce(category ->> 'en', '') || ' ' ||
    coalesce(location ->> 'vi', '') || ' ' || coalesce(location ->> 'en', '')
  );
$$;

-- 5) Dựng lại index GIN với cùng biểu thức (giờ nhận JSONB).
CREATE INDEX IF NOT EXISTS "projects_search_idx"
  ON "projects"
  USING GIN (project_search_document("title", "summary", "description", "category", "location"));
