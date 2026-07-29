// Kiểm tra nhanh tài khoản bootstrap sau khi seed — dùng để chẩn đoán CI đỏ
// kiểu "Expected: DRAFT / Received: PUBLISHED" (nguyên nhân thường là tài khoản
// bootstrap bị seed thành SUPER_ADMIN, vốn bỏ qua luồng duyệt nội dung).
//
// Chạy:  npm run prisma:verify:bootstrap
//
// CHỈ in vai trò + trạng thái thiết lập/kích hoạt. KHÔNG in email, mật khẩu,
// hash, token hay DATABASE_URL — an toàn để dán vào log CI công khai.
require('dotenv/config');
const { Client } = require('pg');

async function main() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    throw new Error('Thiếu ADMIN_EMAIL.');
  }

  const useSsl = /\brender\.com\b/.test(process.env.DATABASE_URL ?? '');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  try {
    const res = await client.query(
      `SELECT role,
              setup_completed_at IS NOT NULL AS setup_completed,
              is_active
         FROM users
        WHERE email = $1`,
      [email],
    );

    if (res.rowCount === 0) {
      throw new Error(
        'Không tìm thấy tài khoản bootstrap (ADMIN_EMAIL) — seed chưa chạy?',
      );
    }

    const row = res.rows[0];
    console.log(`bootstrap role   : ${row.role}`);
    console.log(`setup completed  : ${row.setup_completed}`);
    console.log(`active           : ${row.is_active}`);

    // Vai trò mong đợi mặc định là ADMIN (khớp smoke test `app.e2e-spec.ts`).
    // Đặt EXPECT_ROLE khi muốn kiểm một vai trò khác.
    const expected = process.env.EXPECT_ROLE ?? 'ADMIN';
    if (row.role !== expected) {
      throw new Error(
        `Expected bootstrap E2E account role ${expected}. ` +
          `Check ADMIN_ROLE and seed upsert. (đang nhận: ${row.role})`,
      );
    }
    console.log(`✅ Vai trò đúng như mong đợi (${expected}).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(
    '❌ Kiểm tra tài khoản bootstrap thất bại:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
