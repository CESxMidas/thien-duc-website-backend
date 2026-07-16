// Seed hai trang nội dung `gioi-thieu` + `lien-he` (Q11 — quick win, mở đường
// cho task →4 nhập bản dịch tiếng Anh).
//
// Nội dung lấy NGUYÊN VĂN từ copy dự phòng đang chạy trên frontend
// (`frontend/src/data/about.ts` + `contact.ts`) — trang public không đổi một
// chữ nào sau khi seed, chỉ chuyển nguồn từ fallback tĩnh sang CMS. Vì nội
// dung này vốn đã công khai nên status đặt PUBLISHED ngay.
//
// Khác các seed khác (upsert): seed này CHỈ TẠO KHI CHƯA CÓ
// (`ON CONFLICT DO NOTHING`) — trang nội dung là dữ liệu Admin CMS sẽ sửa
// trực tiếp, chạy lại seed không được phép đè mất bản admin đã biên tập.
//
// Tiếng Anh cố ý bỏ trống: repo chưa có bản dịch EN chính thức cho phần copy
// này (task →4 sẽ nhập qua Admin CMS — chấm vàng "chưa dịch" là chỉ dấu đúng).
//
// Chạy:  npm run prisma:seed:pages
require('dotenv/config');
const { Client } = require('pg');

/** Field song ngữ: chỉ có tiếng Việt — bản tiếng Anh nhập ở task →4. */
const vi = (text) => ({ vi: text });

/** `content` là mảng đoạn văn, mỗi đoạn là một field song ngữ. */
const paragraphs = (texts) => JSON.stringify(texts.map(vi));

const pages = [
  {
    // FE đọc: title = tiêu đề trang, đoạn 1 = mô tả dưới tiêu đề, đoạn 2+ =
    // khối "Định hướng phát triển" (xem app/[locale]/gioi-thieu/page.tsx).
    slug: 'gioi-thieu',
    title: 'Tổng quan về Công ty Thiên Đức',
    content: [
      'Công ty TNHH Đầu tư Xây dựng Thương mại Thiên Đức thành lập năm 2010, hoạt động trong lĩnh vực đầu tư, xây dựng, thương mại và phát triển bất động sản tại TP.HCM và các tỉnh phía Nam. Hơn 16 năm phát triển, từng hợp tác cùng CapitaLand và hiện là chủ đầu tư khu đô thị Hưng Phú tại Bến Tre.',
      'Thiên Đức được thành lập năm 2010 bởi đội ngũ chuyên gia, kiến trúc sư và kỹ sư nhiều năm kinh nghiệm trong ngành xây dựng Việt Nam.',
      'Giai đoạn 2014 - 2018 đánh dấu bước ngoặt khi công ty hợp tác chiến lược cùng tập đoàn bất động sản quốc tế CapitaLand, triển khai và bàn giao thành công các tổ hợp căn hộ cao cấp chuẩn quốc tế tại TP.HCM.',
      'Từ năm 2018 đến nay, Thiên Đức mở rộng quỹ đất và vai trò chủ đầu tư sang các tỉnh thành phía Nam, tiêu biểu là khu đô thị quy mô lớn tại tỉnh Bến Tre.',
    ],
  },
  {
    // FE đọc: title = tiêu đề trang, đoạn 1 = mô tả dưới tiêu đề
    // (xem app/[locale]/lien-he/page.tsx).
    slug: 'lien-he',
    title: 'Kết nối với Thiên Đức',
    content: [
      'Thông tin liên hệ chính thức dành cho khách hàng, đối tác và các bên quan tâm đến hoạt động của Thiên Đức.',
    ],
  },
];

async function main() {
  const useSsl = /\brender\.com\b/.test(process.env.DATABASE_URL ?? '');

  // `.env` của máy dev đang trỏ vào Render (production). Ghi vào production
  // phải xác nhận có chủ ý, không để lỡ tay chạy nhầm.
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

  let created = 0;
  for (const page of pages) {
    const res = await client.query(
      `INSERT INTO pages (id, slug, title, content, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'PUBLISHED', now(), now())
       ON CONFLICT (slug) DO NOTHING`,
      [page.slug, JSON.stringify(vi(page.title)), paragraphs(page.content)],
    );
    if (res.rowCount === 1) {
      created += 1;
      console.log(`✅ Đã tạo trang "${page.slug}"`);
    } else {
      console.log(`⏭️  Trang "${page.slug}" đã tồn tại — giữ nguyên (không đè)`);
    }
  }
  console.log(`Xong: tạo mới ${created}/${pages.length} trang.`);

  await client.end();
}

main().catch((error) => {
  console.error(
    '❌ Seed thất bại:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
