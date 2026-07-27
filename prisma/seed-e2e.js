// Seed tài khoản E2E cục bộ (idempotent — chạy lại nhiều lần vẫn an toàn).
//
// KHÁC prisma/seed.js: file này CHỈ dùng cho môi trường test cục bộ. Nó gieo hai
// tài khoản giả cố định (SUPER_ADMIN + ADMIN) mà bộ test e2e cần, và có một
// "cầu chì an toàn" cứng: chỉ chạy khi DATABASE_URL trỏ tới localhost/127.0.0.1
// và đúng database `thien_duc_test`. Bất kỳ host/DB nào khác → hủy TRƯỚC khi ghi.
// Nhờ vậy không thể lỡ tay gieo tài khoản test vào DB thật (production dùng
// prisma/seed.js với 1 tài khoản đọc từ ADMIN_EMAIL/ADMIN_PASSWORD).
//
// Không hardcode thông tin đăng nhập vào repo — đọc từ biến môi trường:
//   SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD  (tài khoản SUPER_ADMIN)
//   ADMIN_EMAIL       / ADMIN_PASSWORD        (tài khoản ADMIN)
//
// Chạy:  npx prisma db seed   (đã cấu hình migrations.seed ở prisma.config.ts)
//
// Dùng pg + bcrypt trực tiếp (không qua Prisma client) để khớp đúng cách
// AuthService xác thực (bcrypt.compare với password_hash). SALT_ROUNDS = 12
// giống users.service.ts / auth.service.ts.
require('dotenv/config');
const { Client } = require('pg');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;
const REQUIRED_DB = 'thien_duc_test';
const ALLOWED_HOSTS = ['localhost', '127.0.0.1'];

/**
 * Cầu chì an toàn — chỉ cho phép chạy trên DB test cục bộ. Không in DATABASE_URL
 * đầy đủ (có mật khẩu); chỉ báo host + tên DB để chẩn đoán. Trả về { host, db }.
 */
function assertLocalTestDatabase() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('Thiếu DATABASE_URL.');
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL không phải URL hợp lệ.');
  }

  const host = url.hostname;
  const db = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (!ALLOWED_HOSTS.includes(host)) {
    throw new Error(
      `Cầu chì an toàn: host phải là ${ALLOWED_HOSTS.join(' hoặc ')}, nhận "${host}". Hủy trước khi ghi.`,
    );
  }
  if (db !== REQUIRED_DB) {
    throw new Error(
      `Cầu chì an toàn: database phải đúng "${REQUIRED_DB}", nhận "${db}". Hủy trước khi ghi.`,
    );
  }

  return { host, db };
}

/** Đọc + kiểm tra một cặp email/password từ env. */
function readAccount(label, emailVar, passwordVar, role) {
  const email = process.env[emailVar];
  const password = process.env[passwordVar];
  if (!email || !password) {
    throw new Error(
      `Thiếu ${emailVar} hoặc ${passwordVar} (tài khoản ${label}).`,
    );
  }
  if (password.length < 8) {
    throw new Error(`${passwordVar} phải có ít nhất 8 ký tự.`);
  }
  return { email, password, role, name: label };
}

async function main() {
  const { host, db } = assertLocalTestDatabase();

  const accounts = [
    readAccount(
      'Super Admin E2E',
      'SUPER_ADMIN_EMAIL',
      'SUPER_ADMIN_PASSWORD',
      'SUPER_ADMIN',
    ),
    readAccount('Admin E2E', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN'),
  ];

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (const acc of accounts) {
      const passwordHash = await bcrypt.hash(acc.password, SALT_ROUNDS);
      // Upsert theo email (unique). setup_completed_at đặt non-null để qua cổng
      // chặn đăng nhập ở auth.service (tài khoản chờ thiết lập không login được);
      // COALESCE để không dời mốc cũ khi chạy lại. Reset khóa/đếm sai để đăng
      // nhập được ngay. KHÔNG tạo invitation/reset token, KHÔNG gửi email,
      // KHÔNG đụng user khác.
      const res = await client.query(
        `INSERT INTO users
           (id, email, password_hash, name, role, is_active, setup_completed_at, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4::"Role", true, now(), now(), now())
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               name = EXCLUDED.name,
               role = EXCLUDED.role,
               is_active = true,
               setup_completed_at = COALESCE(users.setup_completed_at, now()),
               failed_login_attempts = 0,
               locked_until = NULL,
               updated_at = now()
         RETURNING email, role`,
        [acc.email, passwordHash, acc.name, acc.role],
      );
      const row = res.rows[0];
      // KHÔNG log mật khẩu/hash — chỉ log thông tin không nhạy cảm.
      console.log(`✅ Đã seed: ${row.email} (vai trò ${row.role})`);
    }
  } finally {
    await client.end();
  }

  console.log(`✅ Hoàn tất seed E2E trên ${host}/${db}.`);
}

main().catch((error) => {
  console.error(
    '❌ Seed E2E thất bại:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
