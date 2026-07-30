// Kiểm tra nhanh tài khoản bootstrap sau khi seed — dùng để chẩn đoán CI đỏ
// kiểu "Expected: DRAFT / Received: PUBLISHED" (nguyên nhân thường là tài khoản
// bootstrap bị seed thành SUPER_ADMIN, vốn bỏ qua luồng duyệt nội dung).
//
// Chạy:  npm run prisma:verify:bootstrap
//
// Luôn kiểm tài khoản ADMIN_EMAIL (vai trò mong đợi ADMIN, hoặc EXPECT_ROLE).
// Nếu có SUPER_ADMIN_EMAIL (môi trường E2E) thì kiểm luôn tài khoản đó phải là
// SUPER_ADMIN — `http-foundation.e2e-spec.ts` đăng nhập bằng nó và cần quyền
// SUPER_ADMIN để bài tạo mới ra thẳng PUBLISHED.
//
// CHỈ in vai trò + trạng thái thiết lập/kích hoạt. KHÔNG in email, mật khẩu,
// hash, token hay DATABASE_URL — an toàn để dán vào log CI công khai.
require('dotenv/config');
const { Client } = require('pg');

/** Kiểm một tài khoản; ném lỗi nếu thiếu, sai vai trò, chưa thiết lập hoặc bị vô hiệu. */
async function verifyAccount(client, { label, email, expectedRole, envVar }) {
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
      `Không tìm thấy tài khoản ${label} (${envVar}) — seed chưa chạy?`,
    );
  }

  const row = res.rows[0];
  console.log(`[${label}] role            : ${row.role}`);
  console.log(`[${label}] setup completed : ${row.setup_completed}`);
  console.log(`[${label}] active          : ${row.is_active}`);

  if (row.role !== expectedRole) {
    throw new Error(
      `Expected ${label} account role ${expectedRole}. ` +
        `Check ${envVar === 'ADMIN_EMAIL' ? 'ADMIN_ROLE' : envVar} and seed upsert. (đang nhận: ${row.role})`,
    );
  }
  if (!row.setup_completed) {
    throw new Error(
      `Tài khoản ${label} chưa hoàn tất thiết lập (setup_completed_at = NULL) → không đăng nhập được.`,
    );
  }
  if (!row.is_active) {
    throw new Error(`Tài khoản ${label} đang bị vô hiệu (is_active = false).`);
  }
  console.log(`✅ [${label}] đúng như mong đợi (${expectedRole}).`);
}

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
    // Vai trò mong đợi mặc định là ADMIN (khớp smoke test `app.e2e-spec.ts`).
    // Đặt EXPECT_ROLE khi muốn kiểm một vai trò khác.
    await verifyAccount(client, {
      label: 'bootstrap ADMIN',
      email,
      expectedRole: process.env.EXPECT_ROLE ?? 'ADMIN',
      envVar: 'ADMIN_EMAIL',
    });

    if (process.env.SUPER_ADMIN_EMAIL) {
      await verifyAccount(client, {
        label: 'bootstrap SUPER_ADMIN',
        email: process.env.SUPER_ADMIN_EMAIL,
        expectedRole: 'SUPER_ADMIN',
        envVar: 'SUPER_ADMIN_EMAIL',
      });
    }
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
