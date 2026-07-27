/**
 * Setup chạy TRƯỚC khi nạp AppModule cho bộ e2e/integration: bật cờ E2E để
 * `E2eAwareThrottlerGuard` bỏ qua rate-limit (test tương tranh mới tất định) và
 * để MailService dùng transport giả. Chỉ có tác dụng trong tiến trình test.
 */
process.env.NODE_ENV = 'test';
process.env.MAIL_FAKE_TRANSPORT = '1';
