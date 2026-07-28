// Seed nội dung banner trang chủ (idempotent — chạy lại nhiều lần vẫn an toàn).
//
// Nội dung nằm ở `prisma/banner-content.json` để **một nguồn sự thật duy nhất**
// vừa cho seed này, vừa cho test `src/banners/banner-content.spec.ts` (kiểm nội
// dung qua đúng `CreateBannerDto`). Sửa chữ thì sửa file JSON, không sửa ở đây.
//
// Nguồn dữ kiện trong nội dung (đã được công ty xác nhận, xem
// `docs/01-requirements/open-questions.md` mục 1 câu 2 và câu 7):
//   • Khu đô thị Hưng Phú — Nguyễn Thị Định, phường Phú Tân, TP. Bến Tre;
//     11,25 ha; 330 căn nhà ở thấp tầng; hạ tầng nội khu đã hoàn thiện.
//   • Fancy Tower — 19 tầng nổi + 1 tầng hầm, 196 căn hộ, đã nghiệm thu hoàn
//     thành công trình và bàn giao vận hành; chung cư cao tầng đầu tiên khu vực.
//   • Thiên Đức thành lập 2010; hợp tác CapitaLand tại TP.HCM (2014–2018); từ
//     2018 làm chủ đầu tư khu đô thị phía Nam. Giá trị cốt lõi: Uy tín — Chất
//     lượng — Đột phá — Bền vững.
// KHÔNG thêm số liệu/giải thưởng/mốc thời gian ngoài danh sách trên.
//
// Ảnh: dùng lại đúng 4 ảnh banner đã có sẵn trong `frontend/public/images/
// banners/home/` (đồng bộ từ `thien-duc-website-resources`). Seed KHÔNG upload
// và KHÔNG tạo ảnh mới.
//
// Chạy:  npm run prisma:seed:banners
//
// Idempotent thế nào: bảng `banners` không có ràng buộc UNIQUE nên không dùng
// được `ON CONFLICT`. Khóa nghiệp vụ ở đây là `image` — mỗi ảnh đúng một banner.
// Có bản ghi cùng `image` → UPDATE (GIỮ NGUYÊN id, không xóa rồi tạo lại, để
// không mất tham chiếu/thứ tự do biên tập viên đã chỉnh). Chưa có → INSERT.
// KHÔNG xóa banner nào khác: banner do Admin tự thêm vẫn còn nguyên.
require('dotenv/config');
const { Client } = require('pg');

const banners = require('./banner-content.json');

async function main() {
  const useSsl = /\brender\.com\b/.test(process.env.DATABASE_URL ?? '');

  // `.env` của máy dev có thể trỏ vào Render (production). Seed ghi đè nội dung
  // banner trang chủ nên phải xác nhận có chủ ý, không để lỡ tay chạy nhầm.
  if (useSsl && process.env.SEED_CONFIRM_PRODUCTION !== 'yes') {
    throw new Error(
      'DATABASE_URL đang trỏ vào production (Render). Chạy lại với ' +
        'SEED_CONFIRM_PRODUCTION=yes nếu thực sự muốn seed production.',
    );
  }

  // Chặn ngay ở đây thay vì để DB báo lỗi ràng buộc: hai bản ghi cùng `image`
  // sẽ phá thế idempotent (lần chạy sau update nhầm bản ghi).
  const images = banners.map((banner) => banner.image);
  if (new Set(images).size !== images.length) {
    throw new Error('banner-content.json có ảnh trùng lặp giữa các banner.');
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  let created = 0;
  let updated = 0;

  try {
    for (const banner of banners) {
      // Chọn bản ghi cũ nhất khi lỡ có trùng ảnh từ trước: cập nhật đúng một
      // bản ghi tất định, không nhảy qua lại giữa các lần chạy.
      const existing = await client.query(
        'SELECT id FROM banners WHERE image = $1 ORDER BY created_at ASC LIMIT 1',
        [banner.image],
      );

      const params = [
        banner.image,
        banner.eyebrow ?? null,
        banner.title,
        banner.subtitle ?? null,
        banner.href,
        banner.ctaLabel ?? null,
        banner.objectPosition ?? null,
        banner.order,
        banner.isActive,
      ];

      if (existing.rowCount > 0) {
        await client.query(
          `UPDATE banners
              SET image = $1, eyebrow = $2, title = $3, subtitle = $4,
                  href = $5, cta_label = $6, object_position = $7,
                  "order" = $8, is_active = $9, updated_at = now()
            WHERE id = $10`,
          [...params, existing.rows[0].id],
        );
        updated += 1;
        console.log(`↻ Cập nhật: ${banner.title.vi}`);
      } else {
        await client.query(
          `INSERT INTO banners
             (id, image, eyebrow, title, subtitle, href, cta_label,
              object_position, "order", is_active, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())`,
          params,
        );
        created += 1;
        console.log(`✅ Thêm mới: ${banner.title.vi}`);
      }
    }
  } finally {
    await client.end();
  }

  console.log(
    `\n✅ Đã seed ${banners.length} banner trang chủ (${created} thêm mới, ${updated} cập nhật).`,
  );
}

main().catch((error) => {
  console.error(
    '❌ Seed banner thất bại:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
