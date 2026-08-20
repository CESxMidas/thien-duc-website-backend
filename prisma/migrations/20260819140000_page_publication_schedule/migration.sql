-- Lịch đăng cho TRANG NỘI DUNG (Batch 11) — hai cột mốc thời gian, cùng ngữ
-- nghĩa với `news_posts` (Batch 3), `projects` (Batch 9), `cooperation_projects`
-- (Batch 10).
--
--   published_at  = mốc công khai LẦN ĐẦU. Không bị ghi đè bởi lần đăng lại,
--                   cũng không bị thay bằng giờ cron tình cờ chạy.
--   scheduled_at  = lịch hẹn đăng đang chờ. Bất biến của lệnh đặt lịch:
--                   scheduled_at IS NOT NULL  ⇒  published_at = scheduled_at.
--
-- CHÚ Ý tên cột trạng thái: bảng này dùng `status` (giống `news_posts`), KHÔNG
-- phải `content_status` như `projects`/`cooperation_projects`.
--
-- Cả hai cột đều NULL cho mọi hàng đang có. Đó là điều DUY NHẤT migration này
-- làm với dữ liệu cũ: **không** đoán ngược mốc công khai cho các trang đã đăng.
-- Suy từ `updated_at`/`created_at` sẽ sai với mọi bản ghi từng được sửa sau khi
-- đăng, và sai theo hướng khó phát hiện. Hệ quả đã biết, cố ý chấp nhận và được
-- xử lý ở tầng ứng dụng: một trang đang `status = 'PUBLISHED'` vẫn luôn bị coi
-- là ĐÃ công khai (không hẹn giờ lại được) nhờ chính cột trạng thái, không cần
-- `published_at`.

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "scheduled_at" TIMESTAMP(3);

-- Chỉ mục cho reconciler đăng theo lịch: nó quét đúng
--   WHERE status = 'PENDING' AND scheduled_at IS NOT NULL AND scheduled_at <= <utc now>
-- nên index PHẦN (partial) trên đúng tập hàng đó là đủ và rất nhỏ — số trang
-- đang hẹn giờ luôn đếm trên đầu ngón tay.
--
-- Điều kiện chặt đúng bằng vị từ của reconciler (`= 'PENDING'`), giống
-- `projects_scheduled_at_idx` và `cooperation_projects_scheduled_at_idx`: hàng
-- dị dạng `DRAFT` + lịch quá khứ không cần nằm trong index — nó không bao giờ
-- được đăng, và cũng không được phép lọt ra công khai.
CREATE INDEX IF NOT EXISTS "pages_scheduled_at_idx"
  ON "pages" ("scheduled_at")
  WHERE "scheduled_at" IS NOT NULL AND "status" = 'PENDING';
