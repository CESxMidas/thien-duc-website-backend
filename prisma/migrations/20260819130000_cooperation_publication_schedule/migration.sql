-- Lịch đăng cho DỰ ÁN HỢP TÁC (Batch 10) — hai cột mốc thời gian, cùng ngữ
-- nghĩa với `news_posts` (Batch 3) và `projects` (Batch 9).
--
--   published_at  = mốc công khai LẦN ĐẦU. Không bị ghi đè bởi lần đăng lại,
--                   cũng không bị thay bằng giờ cron tình cờ chạy.
--   scheduled_at  = lịch hẹn đăng đang chờ. Bất biến của lệnh đặt lịch:
--                   scheduled_at IS NOT NULL  ⇒  published_at = scheduled_at.
--
-- KHÔNG đụng tới cột `status` của bảng này: ở `cooperation_projects`, `status`
-- là JSONB mô tả bằng CHỮ (vd. {"vi":"Đã bàn giao"}) — nội dung biên tập, không
-- phải bậc thang duyệt. Bậc thang duyệt là `content_status`.
--
-- Cả hai cột đều NULL cho mọi hàng đang có. Đó là điều DUY NHẤT migration này
-- làm với dữ liệu cũ: **không** đoán ngược mốc công khai cho các dự án hợp tác
-- đã đăng. Suy từ `updated_at` sẽ sai với mọi bản ghi từng được sửa sau khi
-- đăng, và sai theo hướng khó phát hiện. Hệ quả đã biết, cố ý chấp nhận và được
-- xử lý ở tầng ứng dụng: một bản ghi đang `content_status = 'PUBLISHED'` vẫn
-- luôn bị coi là ĐÃ công khai (không hẹn giờ lại được) nhờ chính cột trạng
-- thái, không cần `published_at`. Chỉ bản ghi từng đăng rồi bị gỡ về nháp TRƯỚC
-- migration này là không còn dấu vết trong DB — xem ghi chú giới hạn ở
-- `cooperation.service.ts`.

-- AlterTable
ALTER TABLE "cooperation_projects" ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "scheduled_at" TIMESTAMP(3);

-- Chỉ mục cho reconciler đăng theo lịch: nó quét đúng
--   WHERE content_status = 'PENDING' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()
-- nên index PHẦN (partial) trên đúng tập hàng đó là đủ và rất nhỏ — số dự án
-- hợp tác đang hẹn giờ luôn đếm trên đầu ngón tay.
--
-- Điều kiện giống hệt `projects_scheduled_at_idx` (Batch 9) và chặt hơn index
-- của tin tức: ở đây vị từ hiển thị công khai lẫn reconciler đều đòi ĐÚNG
-- `PENDING`, nên hàng dị dạng `DRAFT` + lịch quá khứ không cần nằm trong index
-- — nó không bao giờ được đăng, và cũng không được phép lọt ra công khai.
CREATE INDEX IF NOT EXISTS "cooperation_projects_scheduled_at_idx"
  ON "cooperation_projects" ("scheduled_at")
  WHERE "scheduled_at" IS NOT NULL AND "content_status" = 'PENDING';
