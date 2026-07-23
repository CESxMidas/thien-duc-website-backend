-- CMS-ACCOUNT-INVITATION Phase 1: nền tảng lời mời thiết lập tài khoản.
--
-- Thứ tự bắt buộc để không khóa đăng nhập của tài khoản đang tồn tại (đặc
-- biệt là SUPER_ADMIN duy nhất hiện có):
--   1) Thêm cột nullable `setup_completed_at` — KHÔNG kèm ràng buộc NOT NULL.
--   2) Backfill ngay cột đó cho mọi User đã tồn tại bằng chính `created_at`
--      của họ, để không ai bị coi là "chưa thiết lập" một cách sai lệch.
--   3) Mới tạo bảng `account_invitations` và các ràng buộc liên quan.
-- Không có bước nào trong migration này đọc/ghi `password_hash`, `is_active`,
-- `role`, hay bảng `refresh_tokens` — các trường/bảng đó không bị đụng tới.

-- 1) Cột trạng thái thiết lập tài khoản — nullable, không có default cứng để
--    NULL luôn có nghĩa rõ ràng là "chưa thiết lập" cho các bản ghi mới.
ALTER TABLE "users" ADD COLUMN "setup_completed_at" TIMESTAMP(3);

-- 2) Backfill: mọi User đã tồn tại trước migration này coi như đã "thiết lập"
--    từ lúc được tạo — không tài khoản đang hoạt động nào bị khóa đăng nhập
--    bởi cột mới này.
UPDATE "users" SET "setup_completed_at" = "created_at" WHERE "setup_completed_at" IS NULL;

-- 3) Bảng lời mời thiết lập tài khoản. Tách riêng khỏi refresh_tokens và khỏi
--    bảng password-reset-token tương lai (xem ghi chú trong schema.prisma).
CREATE TABLE "account_invitations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "invited_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_invitations_pkey" PRIMARY KEY ("id")
);

-- Tra cứu lời mời hiện có của một tài khoản (resend/revoke/accept).
CREATE INDEX "account_invitations_user_id_idx" ON "account_invitations"("user_id");

-- Dọn dẹp định kỳ các lời mời đã hết hạn.
CREATE INDEX "account_invitations_expires_at_idx" ON "account_invitations"("expires_at");

-- Token gốc không bao giờ lưu — chỉ lưu hash; ràng buộc unique để không hai
-- lời mời nào vô tình trùng hash (về lý thuyết gần như không thể với token
-- đủ dài, nhưng ràng buộc DB không tốn gì thêm).
CREATE UNIQUE INDEX "account_invitations_token_hash_key" ON "account_invitations"("token_hash");

-- Xóa User (soft-delete thực tế dùng is_active, nhưng ràng buộc FK vẫn cần
-- khai đúng) thì các lời mời của họ cũng nên biến mất theo.
ALTER TABLE "account_invitations" ADD CONSTRAINT "account_invitations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Người mời (luôn là SUPER_ADMIN tại thời điểm mời) không được xóa cứng khỏi
-- DB nếu vẫn còn lời mời tham chiếu tới họ — giữ dấu vết "ai đã mời ai".
ALTER TABLE "account_invitations" ADD CONSTRAINT "account_invitations_invited_by_id_fkey"
  FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
