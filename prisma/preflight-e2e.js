// Preflight môi trường E2E — chạy TRƯỚC `prisma migrate deploy` / `db seed` /
// `npm run test:e2e` để hỏng sớm với thông điệp chỉ đúng biến còn thiếu, thay vì
// để 45 test cùng đỏ ở `beforeAll` với "Thiếu SUPER_ADMIN_EMAIL/...".
//
// Chỉ kiểm SỰ CÓ MẶT và các thuộc tính an toàn (host, tên DB, độ dài mật khẩu).
// KHÔNG in giá trị của bất kỳ biến nào: không email, không mật khẩu, không
// DATABASE_URL, không secret. Chỉ in tên biến + lý do.
//
// Chạy:  npm run e2e:preflight
require('dotenv/config');

const REQUIRED_DB = 'thien_duc_test';
const ALLOWED_HOSTS = ['localhost', '127.0.0.1'];
const MIN_PASSWORD_LENGTH = 8;

// Biến bắt buộc, kèm nơi tiêu thụ — để log CI tự giải thích được vì sao cần.
const REQUIRED_VARS = [
  ['DATABASE_URL', 'prisma migrate/seed + AppModule'],
  ['JWT_ACCESS_SECRET', 'AuthModule khi khởi động'],
  ['SUPER_ADMIN_EMAIL', 'seed-e2e.js + http-foundation.e2e-spec.ts'],
  ['SUPER_ADMIN_PASSWORD', 'seed-e2e.js + http-foundation.e2e-spec.ts'],
  ['ADMIN_EMAIL', 'seed-e2e.js + app.e2e-spec.ts + verify-bootstrap.js'],
  ['ADMIN_PASSWORD', 'seed-e2e.js + app.e2e-spec.ts'],
];
// ADMIN_ROLE KHÔNG bắt buộc: seed-e2e.js gán cứng vai trò (ADMIN cho
// ADMIN_EMAIL, SUPER_ADMIN cho SUPER_ADMIN_EMAIL) và verify-bootstrap.js kiểm
// lại vai trò THẬT trong DB. Nhưng nếu có đặt thì phải là ADMIN (xem bên dưới) —
// đặt SUPER_ADMIN ở đây là dấu hiệu môi trường đang dùng prisma/seed.js.

const errors = [];

/** Biến rỗng cũng tính là thiếu (`env: FOO:` trong YAML cho ra chuỗi rỗng). */
const missing = REQUIRED_VARS.filter(([name]) => !process.env[name]);
if (missing.length > 0) {
  errors.push(
    'Missing required E2E env:\n' +
      missing.map(([name, used]) => `  - ${name}  (${used})`).join('\n'),
  );
}

// DATABASE_URL: chỉ soi host + tên DB, không in URL.
const rawUrl = process.env.DATABASE_URL;
if (rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    errors.push('DATABASE_URL không phải URL hợp lệ.');
  }
  if (url) {
    const db = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!ALLOWED_HOSTS.includes(url.hostname)) {
      errors.push(
        `DATABASE_URL host phải là ${ALLOWED_HOSTS.join(' hoặc ')} (nhận "${url.hostname}") — E2E không được chạm DB từ xa.`,
      );
    }
    if (db !== REQUIRED_DB) {
      errors.push(
        `DATABASE_URL database phải đúng "${REQUIRED_DB}" (nhận "${db}") — khớp cầu chì an toàn của prisma/seed-e2e.js.`,
      );
    }
  }
}

if (process.env.NODE_ENV !== 'test') {
  errors.push(
    `NODE_ENV phải là "test" (nhận "${process.env.NODE_ENV ?? '<không đặt>'}").`,
  );
}

if (process.env.MAIL_FAKE_TRANSPORT !== '1') {
  errors.push(
    'MAIL_FAKE_TRANSPORT phải là "1" — chặn mọi lời gọi email thật (Resend) trong E2E.',
  );
}

// Vai trò bootstrap: app.e2e-spec.ts khẳng định bài mới là DRAFT, chỉ đúng với
// ADMIN (SUPER_ADMIN bỏ qua luồng duyệt → PUBLISHED ngay).
if (process.env.ADMIN_ROLE && process.env.ADMIN_ROLE !== 'ADMIN') {
  errors.push(
    `ADMIN_ROLE phải là "ADMIN" cho E2E (nhận "${process.env.ADMIN_ROLE}").`,
  );
}

// Độ dài mật khẩu — khớp kiểm tra của seed-e2e.js. Chỉ báo tên biến.
for (const name of ['SUPER_ADMIN_PASSWORD', 'ADMIN_PASSWORD']) {
  const value = process.env[name];
  if (value && value.length < MIN_PASSWORD_LENGTH) {
    errors.push(`${name} phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`);
  }
}

// Hai tài khoản phải KHÁC email: cùng email thì upsert theo email sẽ ghi đè vai
// trò của nhau → một trong hai bộ test chắc chắn đỏ.
if (
  process.env.SUPER_ADMIN_EMAIL &&
  process.env.ADMIN_EMAIL &&
  process.env.SUPER_ADMIN_EMAIL.toLowerCase() ===
    process.env.ADMIN_EMAIL.toLowerCase()
) {
  errors.push(
    'SUPER_ADMIN_EMAIL và ADMIN_EMAIL phải khác nhau (cùng email → upsert ghi đè vai trò).',
  );
}

if (errors.length > 0) {
  console.error('❌ Preflight E2E thất bại:\n');
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('✅ Preflight E2E: đủ biến môi trường.');
console.log(`   database        : ${REQUIRED_DB} (host cục bộ)`);
console.log('   NODE_ENV        : test');
console.log('   MAIL_FAKE_TRANSPORT: 1');
console.log('   ADMIN_ROLE      : ADMIN');
