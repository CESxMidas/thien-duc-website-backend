// Seed dữ liệu dự án hợp tác (Vista Verde, Feliz en Vista — cùng CapitaLand).
//
// Nguồn nội dung: docs/CAU-HOI-CAN-XAC-NHAN.md (giai đoạn hợp tác 2014–2018).
// Bảng `cooperation_projects` chỉ có khóa `id` (không có slug duy nhất) nên seed
// theo hướng "xóa sạch rồi nạp lại" để idempotent — chạy lại không nhân bản.
//
// Chạy:  npm run prisma:seed:cooperation
require('dotenv/config');
const { Client } = require('pg');

/** Field song ngữ: hiện chỉ có tiếng Việt, bản tiếng Anh bổ sung sau. */
const vi = (text) => ({ vi: text });

// Ảnh phối cảnh dùng ảnh placeholder thương hiệu (SVG trong frontend public) —
// TODO: thay bằng ảnh thật của từng dự án qua Admin khi có.
const cooperationProjects = [
  {
    name: 'Vista Verde',
    location: 'Quận 2, TP.HCM',
    role: 'Đồng chủ đầu tư',
    partner: 'CapitaLand (Singapore)',
    scale: '25.295 m² · 4 tòa tháp · 1.152 căn hộ',
    status: 'Đã bàn giao',
    image: '/images/cooperation/vista-verde-placeholder.svg',
  },
  {
    name: 'Feliz en Vista',
    location: 'Quận 2, TP.HCM',
    role: 'Đồng chủ đầu tư',
    partner: 'CapitaLand (Singapore)',
    scale: '4 tòa tháp căn hộ cao cấp',
    status: 'Đã bàn giao',
    image: '/images/cooperation/feliz-en-vista-placeholder.svg',
  },
];

async function main() {
  const useSsl = /\brender\.com\b/.test(process.env.DATABASE_URL ?? '');

  // `.env` của máy dev đang trỏ vào Render (production). Seed ghi đè nội dung
  // nên phải xác nhận có chủ ý, không để lỡ tay chạy nhầm.
  if (useSsl && process.env.SEED_CONFIRM_PRODUCTION !== 'yes') {
    throw new Error(
      'DATABASE_URL đang trỏ vào production (Render). Chạy lại với ' +
        'SEED_CONFIRM_PRODUCTION=yes nếu thực sự muốn seed production.',
    );
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  await client.query('DELETE FROM cooperation_projects');

  for (const [order, project] of cooperationProjects.entries()) {
    await client.query(
      `INSERT INTO cooperation_projects
         (id, name, location, role, partner, scale, status, image, content_status, "order", created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'PUBLISHED', $8, now(), now())`,
      [
        vi(project.name),
        vi(project.location),
        vi(project.role),
        vi(project.partner),
        vi(project.scale),
        vi(project.status),
        project.image ?? null,
        order,
      ],
    );
    console.log(`✅ ${project.name} — ${project.partner}`);
  }

  await client.end();
  console.log(`\n✅ Đã seed ${cooperationProjects.length} dự án hợp tác.`);
}

main().catch((error) => {
  console.error(
    '❌ Seed dự án hợp tác thất bại:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
