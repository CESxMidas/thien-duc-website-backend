-- Chỉ mục cho danh sách tin công khai LỌC THEO CHUYÊN MỤC.
--
-- Truy vấn thật (`NewsService.findAllPaginated` khi có `categorySlug`):
--   WHERE category_id = $1 AND status = 'PUBLISHED'
--   ORDER BY published_at DESC, id DESC
--   LIMIT $2 OFFSET $3
--
-- Thứ tự cột theo đúng thứ tự sử dụng: hai cột so sánh bằng (=) đứng trước,
-- cột sắp xếp đứng sau. Nhờ vậy Postgres vừa lọc vừa lấy sẵn thứ tự từ index
-- và dừng ngay khi đủ LIMIT, thay vì gom hết rồi mới sort.
--
-- Index tăng dần vẫn phục vụ được `ORDER BY ... DESC` (quét ngược index), nên
-- không cần khai báo DESC — giữ nguyên dạng Prisma sinh ra từ `@@index`.
--
-- Trước migration này bảng `news_posts` KHÔNG có index nào trên `category_id`:
-- mỗi lần mở một chuyên mục là một lượt quét toàn bảng cộng sort.

-- CreateIndex
CREATE INDEX "news_posts_category_status_published_idx" ON "news_posts"("category_id", "status", "published_at");
