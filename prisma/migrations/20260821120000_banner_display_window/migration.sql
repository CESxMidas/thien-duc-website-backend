-- CỬA SỔ HIỂN THỊ BANNER (Batch 12) — KHÔNG phải lịch xuất bản.
--
-- Cố ý KHÔNG tái sử dụng cặp `published_at`/`scheduled_at` như `news_posts`,
-- `projects`, `cooperation_projects`, `pages`. Ở các bảng đó hai cột kia gắn
-- chặt với vòng đời duyệt bài (DRAFT → PENDING → PUBLISHED) và có reconciler
-- đổi `status` khi tới hạn. Banner không có vòng đời đó và không được sinh ra
-- một cái: hai cột dưới đây chỉ mô tả **khoảng thời gian banner đủ điều kiện
-- hiện**, xét lúc truy vấn.
--
--   display_from   = mốc bắt đầu đủ điều kiện. NULL ⇒ không có biên dưới.
--   display_until  = mốc hết đủ điều kiện.     NULL ⇒ không có biên trên.
--
-- Khoảng NỬA MỞ [display_from, display_until): đúng lúc display_from thì hiện,
-- đúng lúc display_until thì tắt. Nhờ vậy hai banner nối đuôi nhau tại cùng một
-- mốc không có giây nào chồng lấn, cũng không có giây nào trống.
--
-- TƯƠNG THÍCH NGƯỢC: cả hai cột NULL cho mọi hàng đang có, và KHÔNG backfill.
-- Vị từ hiển thị bỏ qua biên NULL, nên mọi banner cũ giữ nguyên hành vi trước
-- Batch 12 — chỉ còn `is_active` quyết định.

-- AlterTable
ALTER TABLE "banners" ADD COLUMN     "display_from" TIMESTAMP(3),
ADD COLUMN     "display_until" TIMESTAMP(3);

-- KHÔNG tạo index — có chủ ý, không phải bỏ sót.
--
-- Truy vấn công khai là:
--   WHERE is_active = true
--     AND (display_from  IS NULL OR display_from  <= $now)
--     AND (display_until IS NULL OR display_until >  $now)
--   ORDER BY "order" ASC, created_at ASC
--
-- Khác với `*_scheduled_at_idx` của các bảng nội dung: những index đó phục vụ
-- reconciler quét ĐỊNH KỲ trên bảng hàng nghìn hàng, và là index PHẦN chỉ chứa
-- đúng nhúm hàng đang hẹn giờ. Ở đây `banners` là bảng cấu hình trang chủ với
-- số hàng đếm trên đầu ngón tay (seed hiện tại: 4). Postgres sẽ seq-scan bất kể
-- có index hay không vì đọc cả bảng rẻ hơn đi qua index; hơn nữa vị từ có hai
-- nhánh OR-NULL nên index B-tree thường không dùng được trọn vẹn. Thêm index ở
-- quy mô này chỉ tốn thêm chi phí ghi mỗi lần sửa banner mà không đổi kế hoạch
-- truy vấn. Khi nào bảng lớn tới hàng nghìn hàng thì hãy đo lại rồi mới thêm.
