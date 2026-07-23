import * as crypto from 'crypto';

/**
 * Token cơ hội (opaque token) dùng một lần cho các luồng nhạy cảm cần gửi
 * qua email — lời mời thiết lập tài khoản, và sau này là đặt lại mật khẩu.
 * Chỉ dùng chung utility này giữa hai luồng, KHÔNG dùng chung bảng/service
 * nghiệp vụ (xem ghi chú ở AccountInvitation trong schema.prisma).
 *
 * Bản rõ (`token`) chỉ được trả về đúng một lần cho nơi gọi đáng tin cậy để
 * gửi email — không bao giờ được lưu DB hay ghi log. Chỉ `tokenHash` (băm
 * một chiều) mới được lưu; so khớp khi validate bằng cách băm lại token
 * nhận được rồi so sánh hash, không bao giờ giải mã ngược.
 */

const TOKEN_BYTES = 32;

export interface OpaqueToken {
  /** Bản rõ — chỉ giữ trong bộ nhớ, gửi qua email, không bao giờ lưu/log. */
  token: string;
  /** Băm SHA-256 của token — đây mới là giá trị được lưu vào DB. */
  tokenHash: string;
}

/** Sinh token ngẫu nhiên an toàn (32 byte, mã hoá URL-safe) kèm hash của nó. */
export function generateOpaqueToken(): OpaqueToken {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashOpaqueToken(token) };
}

/** Băm xác định (deterministic) — dùng để so khớp token khi validate/accept. */
export function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
