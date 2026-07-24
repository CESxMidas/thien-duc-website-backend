-- CMS-AUTH-FORGOT-PASSWORD-PHASE1-BACKEND-M1: bảng token đặt lại mật khẩu.
--
-- Bảng RIÊNG, KHÔNG tái dùng `account_invitations` (mục đích, người khởi tạo và
-- vòng đời khác nhau — xem ghi chú trong schema.prisma). Token gốc không bao giờ
-- lưu — chỉ lưu `token_hash` (SHA-256). Migration này KHÔNG đọc/ghi
-- `password_hash`, `is_active`, `role`, cũng không đụng bảng `users` (ngoài khóa
-- ngoại tham chiếu), `account_invitations` hay `refresh_tokens`.

CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- Token gốc không bao giờ lưu — chỉ lưu hash; ràng buộc unique để không hai
-- token nào vô tình trùng hash.
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- Tra cứu token hiện có của một tài khoản (cooldown/revoke).
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- Dọn dẹp định kỳ các token đã hết hạn.
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- Xóa User thì mọi token đặt lại mật khẩu của họ cũng biến mất theo.
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
