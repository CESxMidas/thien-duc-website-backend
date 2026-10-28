BEGIN;

-- Giữ nội dung của bài cũ chỉ có tóm tắt trước khi bỏ cột nhập riêng.
UPDATE "news_posts"
SET "content" = jsonb_build_array("summary")
WHERE ("content" IS NULL OR "content" = 'null'::jsonb OR "content" = '[]'::jsonb)
  AND (length(trim(coalesce("summary" ->> 'vi', ''))) > 0
    OR length(trim(coalesce("summary" ->> 'en', ''))) > 0);

DROP INDEX IF EXISTS "news_posts_search_idx";
DROP FUNCTION public.news_search_document(JSONB, JSONB, JSONB, TEXT);

CREATE FUNCTION public.news_search_document(
  title JSONB,
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
      coalesce(content::text, '') || ' ' || coalesce(author, '')
    )
  );
$$;

ALTER TABLE "news_posts" DROP COLUMN "summary";

CREATE INDEX "news_posts_search_idx" ON "news_posts"
USING GIN (public.news_search_document("title", "content", "author"));

COMMIT;
