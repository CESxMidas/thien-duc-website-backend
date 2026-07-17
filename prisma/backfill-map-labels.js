// Backfill song ngữ cho nhãn overlay bản đồ dự án Hưng Phú (EN-FULL-C5b).
//
// Chuyển `map_location.labels[].text` từ chuỗi thuần (tiếng Việt) sang
// `{ vi, en }`, GIỮ NGUYÊN chính xác:
//   - text tiếng Việt hiện có (đưa vào `vi`),
//   - toàn bộ `left` / `top` / `kind` của từng nhãn,
//   - mọi field khác của `map_location` (heading/description/address đã song
//     ngữ ở C5a, image, marker…).
//
// An toàn:
//   - Idempotent: nhãn đã có `en` thì bỏ qua; chạy lại nhiều lần không đổi.
//   - Chỉ ghi đúng **một** cột `map_location` của **một** dự án (theo slug).
//   - Không phải Prisma migration — `map_location` đã là JSONB.
//   - `--dry-run` (hoặc DRY_RUN=1): chỉ in kế hoạch, KHÔNG ghi DB.
//   - Ghi vào production (Render) phải đặt SEED_CONFIRM_PRODUCTION=yes.
//
// Chạy:
//   Dry-run local/prod:   node prisma/backfill-map-labels.js --dry-run
//   Ghi production:       SEED_CONFIRM_PRODUCTION=yes node prisma/backfill-map-labels.js
//   (hoặc npm run prisma:backfill:map-labels -- --dry-run)

require('dotenv/config');
const { Client } = require('pg');

const PROJECT_SLUG = 'khu-do-thi-hung-phu';

/**
 * Bản dịch tiếng Anh theo **đúng** chuỗi tiếng Việt đang lưu (key = text.vi).
 * Chính sách C5b: bỏ dấu tên riêng, dịch danh từ chung, giữ ngắn gọn.
 */
const EN_BY_VI = {
  // Directions
  'Hướng đi chợ Lách': 'To Cho Lach',
  'Hướng đi cầu Rạch Miễu TP.HCM': 'To Rach Mieu Bridge / Ho Chi Minh City',
  'Hướng đi Tỉnh Lộ 886': 'To Provincial Rd. 886',
  'Hướng đi cầu Hàm Lương': 'To Ham Luong Bridge',
  // Roads
  'Tỉnh lộ 887': 'Provincial Rd. 887',
  'QL.60': 'NH.60',
  'Ngã tư Tân Thành': 'Tan Thanh Junction',
  'Ngã tư Phú Khương': 'Phu Khuong Junction',
  'D.Đồng Văn Cống': 'Dong Van Cong St.',
  'D.Nguyễn Thị Định': 'Nguyen Thi Dinh St.',
  'D.Đoàn Hoàng Minh': 'Doan Hoang Minh St.',
  'D.Đồng Khởi': 'Dong Khoi St.',
  'D.Nguyễn Huệ': 'Nguyen Hue St.',
  'D.Nguyễn Đình Chiểu': 'Nguyen Dinh Chieu St.',
  'D.Hùng Vương': 'Hung Vuong St.',
  // Areas
  'PHƯỜNG PHÚ TÂN': 'PHU TAN WARD',
  'PHƯỜNG PHÚ KHƯƠNG': 'PHU KHUONG WARD',
  'SÔNG BẾN TRE': 'BEN TRE RIVER',
  // Places
  'Trường Cao Đẳng Bến Tre CS2': 'Ben Tre College (Campus 2)',
  'Trường Cao Đẳng Bến Tre': 'Ben Tre College',
  'Trường CĐ Công Nghệ Đông Khởi': 'Dong Khoi Technology College',
  'Bến xe Bến Tre': 'Ben Tre Bus Station',
  'Bến xe Minh Tâm': 'Minh Tam Bus Station',
  'BV Đa Khoa Nguyễn Đình Chiểu': 'Nguyen Dinh Chieu General Hospital',
  'Khu Trung Tâm Hành Chính': 'Administrative Center',
  'TT Thương Mại': 'Commercial Center',
  'ĐL Hàm Luông': 'Ham Luong Boulevard',
};

/** Lấy `vi` từ một label.text (chuỗi cũ hoặc object song ngữ). */
function readVi(text) {
  if (text == null) return '';
  if (typeof text === 'string') return text;
  return typeof text.vi === 'string' ? text.vi : '';
}

/** Đã song ngữ (có `en` không rỗng) chưa? */
function hasEn(text) {
  return (
    text != null &&
    typeof text === 'object' &&
    typeof text.en === 'string' &&
    text.en.trim() !== ''
  );
}

async function main() {
  const dryRun =
    process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
  const useSsl = /\brender\.com\b/.test(process.env.DATABASE_URL ?? '');

  if (!dryRun && useSsl && process.env.SEED_CONFIRM_PRODUCTION !== 'yes') {
    throw new Error(
      'DATABASE_URL đang trỏ vào production (Render). Chạy --dry-run để xem ' +
        'trước, hoặc đặt SEED_CONFIRM_PRODUCTION=yes để ghi thật.',
    );
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    const res = await client.query(
      'SELECT id, map_location FROM projects WHERE slug = $1',
      [PROJECT_SLUG],
    );
    if (res.rowCount === 0) {
      throw new Error(`Không tìm thấy dự án slug="${PROJECT_SLUG}".`);
    }

    const { id, map_location: mapLocation } = res.rows[0];
    const labels = Array.isArray(mapLocation?.labels)
      ? mapLocation.labels
      : [];
    if (labels.length === 0) {
      console.log('⚠️  map_location.labels rỗng — không có gì để backfill.');
      return;
    }

    let converted = 0;
    let skipped = 0;
    const unmapped = [];

    const nextLabels = labels.map((label) => {
      const vi = readVi(label.text);
      if (hasEn(label.text)) {
        skipped += 1;
        return label;
      }
      const en = EN_BY_VI[vi];
      if (!en) {
        unmapped.push(vi);
        // Không có bản dịch → chuẩn hóa về { vi } (giữ VI, không bịa EN).
        return { ...label, text: { vi } };
      }
      converted += 1;
      // Giữ nguyên left/top/kind; chỉ đổi text sang song ngữ.
      return { ...label, text: { vi, en } };
    });

    console.log(
      `Dự án ${PROJECT_SLUG}: ${labels.length} nhãn — ` +
        `${converted} chuyển song ngữ, ${skipped} đã có EN (bỏ qua), ` +
        `${unmapped.length} chưa có bản dịch.`,
    );
    if (unmapped.length > 0) {
      console.log('⚠️  Nhãn chưa map EN (giữ VI):', unmapped);
    }

    if (converted === 0) {
      console.log('✅ Không có thay đổi (đã song ngữ sẵn).');
      return;
    }

    if (dryRun) {
      console.log('\n[DRY-RUN] Không ghi DB. Kết quả dự kiến labels[].text:');
      for (const l of nextLabels) {
        console.log('  -', JSON.stringify(l.text));
      }
      return;
    }

    const nextMapLocation = { ...mapLocation, labels: nextLabels };
    await client.query(
      'UPDATE projects SET map_location = $1, updated_at = now() WHERE id = $2',
      [nextMapLocation, id],
    );
    console.log(`\n✅ Đã cập nhật ${converted} nhãn song ngữ cho ${PROJECT_SLUG}.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(
    '❌ Backfill nhãn bản đồ thất bại:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
