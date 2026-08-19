-- Lịch đăng cho DỰ ÁN (Batch 9) — hai cột mốc thời gian, cùng ngữ nghĩa với
-- `news_posts` đã có từ trước.
--
--   published_at  = mốc công khai LẦN ĐẦU. Không bị ghi đè bởi lần đăng lại,
--                   cũng không bị thay bằng giờ cron tình cờ chạy.
--   scheduled_at  = lịch hẹn đăng đang chờ. Bất biến của lệnh đặt lịch:
--                   scheduled_at IS NOT NULL  ⇒  published_at = scheduled_at.
--
-- Cả hai đều NULL cho mọi hàng đang có. Đó là điều DUY NHẤT migration này làm
-- với dữ liệu cũ: **không** đoán ngược mốc công khai cho các dự án đã đăng.
-- Suy từ `updated_at` sẽ sai với mọi bản ghi từng được sửa sau khi đăng, và sai
-- theo hướng khó phát hiện. Hệ quả đã biết, cố ý chấp nhận và được xử lý ở tầng
-- ứng dụng: một dự án đang `content_status = 'PUBLISHED'` vẫn luôn bị coi là ĐÃ
-- công khai (không hẹn giờ lại được) nhờ chính cột trạng thái, không cần
-- `published_at`. Chỉ dự án từng đăng rồi bị gỡ về nháp TRƯỚC migration này là
-- không còn dấu vết trong DB — xem ghi chú giới hạn ở `projects.service.ts`.

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "scheduled_at" TIMESTAMP(3);

-- Chỉ mục cho reconciler đăng theo lịch: nó quét đúng
--   WHERE content_status = 'PENDING' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()
-- nên index PHẦN (partial) trên đúng tập hàng đó là đủ và rất nhỏ — số dự án
-- đang hẹn giờ luôn đếm trên đầu ngón tay, trong khi bảng thì lớn dần mãi.
--
-- Điều kiện chặt hơn index tương ứng của tin tức (`news_posts_scheduled_at_idx`
-- dùng `status <> 'PUBLISHED'`): ở dự án, vị từ hiển thị công khai lẫn
-- reconciler đều đòi ĐÚNG `PENDING`, nên hàng dị dạng `DRAFT` + lịch quá khứ
-- không cần nằm trong index — nó không bao giờ được đăng, và cũng không được
-- phép lọt ra công khai.
CREATE INDEX IF NOT EXISTS "projects_scheduled_at_idx"
  ON "projects" ("scheduled_at")
  WHERE "scheduled_at" IS NOT NULL AND "content_status" = 'PENDING';
