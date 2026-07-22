import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Số lớp reverse proxy tin cậy đứng trước backend.
 *
 * Render (và hầu hết PaaS) đặt **đúng một** lớp reverse proxy trước app. Khi bật
 * `trust proxy = 1`, Express lấy IP client thật từ header `X-Forwarded-For` (giá
 * trị do proxy tin cậy gắn) thay vì IP của chính proxy. Điều này bắt buộc để
 * `@nestjs/throttler` (rate-limit contact/auth) và `req.ip` (lưu kèm lead) dùng
 * đúng IP người dùng — nếu không, mọi request chung IP proxy sẽ bị gộp chung một
 * "xô" rate-limit (chặn nhầm cả trang) hoặc giới hạn theo IP mất tác dụng.
 *
 * **Không** đặt `true` (tin mọi proxy): khi đó client tự bơm `X-Forwarded-For`
 * để giả IP và lách rate-limit. Chỉ tin đúng số hop hạ tầng thực sự có.
 */
export const TRUSTED_PROXY_HOPS = 1;

/**
 * Bật trust proxy cho ứng dụng Express bên dưới Nest. Tách thành hàm riêng để
 * kiểm thử được mà không phải chạy `bootstrap()` thật (cùng cách `main.spec.ts`
 * kiểm phần CORS). Nhận kiểu rút gọn chỉ cần method `set` để dễ mock trong test.
 */
export function configureTrustProxy(
  app: Pick<NestExpressApplication, 'set'>,
): void {
  app.set('trust proxy', TRUSTED_PROXY_HOPS);
}
