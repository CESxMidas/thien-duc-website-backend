// Khởi tạo Sentry TRƯỚC mọi import khác của app (task →5) — file này phải là
// import đầu tiên trong `main.ts`. Chạy trước cả Nest bootstrap nên đọc thẳng
// `process.env`, không qua ConfigService.
//
// Theo khuôn degrade-thành-no-op (như Cloudinary/Mail): thiếu SENTRY_DSN thì
// không init — captureException về sau tự thành no-op, app chạy bình thường.
import * as Sentry from '@sentry/nestjs';
import type { ErrorEvent } from '@sentry/nestjs';

/**
 * Loại bỏ mọi dữ liệu nhạy cảm khỏi event trước khi gửi lên Sentry.
 *
 * Xoá NGUYÊN `event.request` nên cả URL (có thể chứa `?token=` của link lời
 * mời / reset mật khẩu) lẫn request body (có thể chứa `newPassword`,
 * `confirmPassword`, `token`, hoặc nội dung lead) đều không bao giờ rời máy
 * chủ. Stack trace + message là đủ để truy vết. Tách hàm để test được mà
 * không phá thứ tự import-đầu-tiên của file này.
 */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  delete event.request;
  if (event.user) {
    delete event.user.ip_address;
    delete event.user.email;
  }
  return event;
}

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    // Errors-only: không APM tracing, không PII mặc định (quyết định task →5).
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
  });
} else {
  // Logger của Nest chưa sẵn ở thời điểm này — dùng console cho đúng pha boot.
  console.warn(
    'Thiếu SENTRY_DSN — bỏ qua error tracking (app vẫn chạy bình thường).',
  );
}
