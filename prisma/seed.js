// Seed tài khoản quản trị đầu tiên (idempotent — chạy lại nhiều lần vẫn an toàn).
//
// Không hardcode thông tin đăng nhập vào repo: đọc từ biến môi trường.
//   ADMIN_EMAIL     (bắt buộc)
//   ADMIN_PASSWORD  (bắt buộc, tối thiểu 8 ký tự theo rule FE)
//   ADMIN_NAME      (tùy chọn, mặc định "Quản trị viên")
//   ADMIN_ROLE      (tùy chọn, mặc định SUPER_ADMIN)
//
// Chạy:  ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run prisma:seed
//
// Dùng pg + bcrypt trực tiếp (không qua Prisma client) để chạy được bằng `node`
// thuần, khớp đúng cách AuthService xác thực (bcrypt.compare với password_hash).
require('dotenv/config');
const { Client } = require('pg');
const bcrypt = require('bcrypt');

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? 'Quản trị viên';
  const role = process.env.ADMIN_ROLE ?? 'SUPER_ADMIN';

  if (!email || !password) {
    throw new Error(
      'Thiếu ADMIN_EMAIL hoặc ADMIN_PASSWORD. Ví dụ: ADMIN_EMAIL=admin@gmail.com ADMIN_PASSWORD=... npm run prisma:seed',
    );
  }
  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD phải có ít nhất 8 ký tự.');
  }
  if (!['EDITOR', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
    throw new Error(`ADMIN_ROLE không hợp lệ: ${role}`);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const useSsl = /\brender\.com\b/.test(process.env.DATABASE_URL ?? '');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  const res = await client.query(
    `INSERT INTO users (id, email, password_hash, name, role, is_active, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, true, now(), now())
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           is_active = true,
           failed_login_attempts = 0,
           locked_until = NULL,
           updated_at = now()
     RETURNING email, role`,
    [email, passwordHash, name, role],
  );
  await client.end();

  // KHÔNG log mật khẩu/hash — chỉ log thông tin không nhạy cảm.
  const row = res.rows[0];
  console.log(`✅ Đã seed tài khoản: ${row.email} (vai trò ${row.role})`);
}

main().catch((error) => {
  console.error(
    '❌ Seed thất bại:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
