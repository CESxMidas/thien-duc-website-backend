// Backfill song ngữ cho nội dung hạng mục (project_items) của dự án Hưng Phú
// (EN-PROJECT-ITEMS-P1).
//
// Thêm bản dịch tiếng Anh cho các field hạng mục **đã bilingual-capable** nhưng
// còn thiếu `.en`:
//   - description   (Json — LocalizedText { vi, en } hoặc chuỗi cũ)
//   - highlights    (Json — mảng LocalizedText / chuỗi cũ)
//   - quickFacts    (cột quick_facts — mảng { label, value }, mỗi cái LocalizedText / chuỗi cũ)
//
// GIỮ NGUYÊN chính xác:
//   - Toàn bộ `.vi` hiện có (không bao giờ ghi đè).
//   - `.en` đã có sẵn (idempotent — bỏ qua, không đụng).
//   - Mọi field hạng mục khác (title/summary/status/slug/image/gallery…).
//   - Các phần tử/field không map được → để **nguyên xi**, không chuẩn hóa, không bịa EN.
//
// Khớp EN theo **đúng chuỗi tiếng Việt** đang lưu (key = giá trị `.vi`). Nếu VI ở
// production khác với key duyệt sẵn dưới đây, field đó sẽ được liệt vào "unmapped"
// (giữ nguyên VI) thay vì ghép nhầm — an toàn hơn là đoán.
//
// An toàn:
//   - Idempotent: field đã có `en` thì bỏ qua; chạy lại nhiều lần không đổi.
//   - Chỉ ghi các cột description/highlights/quick_facts của đúng **3 hạng mục** thuộc **một** dự án.
//   - Không phải Prisma migration — các cột đã là JSONB.
//   - `--dry-run` (hoặc DRY_RUN=1): chỉ in kế hoạch, KHÔNG ghi DB.
//   - Ghi vào production (Render) phải đặt SEED_CONFIRM_PRODUCTION=yes.
//
// Chạy:
//   Dry-run local/prod:   node prisma/backfill-project-items.js --dry-run
//   Ghi production:       SEED_CONFIRM_PRODUCTION=yes node prisma/backfill-project-items.js
//   (hoặc npm run prisma:backfill:project-items -- --dry-run)

require('dotenv/config');
const { Client } = require('pg');

const PROJECT_SLUG = 'khu-do-thi-hung-phu';

/**
 * Bản dịch tiếng Anh đã duyệt, keyed theo **đúng** chuỗi tiếng Việt (`.vi`).
 * `description` / `highlights` map theo cả câu; `quickFacts` tách riêng
 * `labels` và `values` để ghép độc lập.
 */
const ITEMS = {
  'fancy-tower': {
    description: {
      'Fancy Tower đã được Sở Xây dựng nghiệm thu hoàn thành công trình và sẵn sàng cấp sổ hồng cho cư dân. Tòa nhà đã hoàn thiện thi công, bàn giao và đưa vào vận hành.':
        'Fancy Tower has been inspected and accepted by the Department of Construction for completion and handover. Residents now receive long-term ownership certificates and enjoy a complete set of amenities including a swimming pool, sky garden, and outdoor gym.',
    },
    highlights: {
      '19 tầng nổi, 1 tầng hầm, 196 căn hộ.':
        '19 above-ground floors and 1 basement, designed with a modern layout and efficient apartment floor plans.',
      'Đã nghiệm thu hoàn thành công trình, sẵn sàng cấp sổ hồng.':
        'Construction has been inspected and accepted; residents are eligible for long-term ownership certificates.',
      'Hồ bơi và khu tiện ích nội khu đã vận hành.':
        'Integrated amenities include a swimming pool, sky garden, outdoor gym, and convenient retail services.',
    },
    quickFactLabels: {
      'Quy mô': 'Scale',
      'Số căn hộ': 'Number of apartments',
      'Tình trạng': 'Status',
    },
    quickFactValues: {
      '19 tầng nổi + 1 tầng hầm': '19 above-ground floors + 1 basement',
      // Hai biến thể VI cho "số căn hộ" / "tình trạng": bản chuẩn hóa và bản
      // seed-shape đang tồn tại song song — map cả hai (exact-match) để `/en`
      // sạch dù production giữ shape nào. Không đụng `.vi`.
      '196 căn hộ': '196 apartments',
      '196 căn': '196 apartments',
      'Đã nghiệm thu, đang bàn giao sổ hồng':
        'Inspected and accepted; ownership certificates are being handed over',
      'Đã bàn giao, đang vận hành': 'Handed over and currently in operation',
    },
  },
  'hung-phu-mall': {
    description: {},
    highlights: {},
    quickFactLabels: { 'Quy mô': 'Scale' },
    quickFactValues: { '5 tầng': '5 floors' },
  },
  'khu-nha-o-thap-tang': {
    description: {},
    highlights: {},
    quickFactLabels: { 'Số căn': 'Number of units' },
    quickFactValues: { '330 căn': '330 units' },
  },
};

/** Lấy `.vi` từ một field (chuỗi cũ hoặc object song ngữ). */
function readVi(text) {
  if (text == null) return '';
  if (typeof text === 'string') return text;
  return typeof text.vi === 'string' ? text.vi : '';
}

/** Đã song ngữ (có `.en` không rỗng) chưa? */
function hasEn(text) {
  return (
    text != null &&
    typeof text === 'object' &&
    typeof text.en === 'string' &&
    text.en.trim() !== ''
  );
}

/**
 * Backfill một field LocalizedText đơn (description hoặc một highlight).
 * Trả về `{ next, outcome, vi }`:
 *   - outcome = 'converted' | 'skipped-en' | 'unmapped' | 'missing'
 *   - `next` là giá trị mới (chỉ khác `current` khi 'converted').
 */
function backfillText(current, enByVi, path, report) {
  if (current === undefined || current === null) {
    return current; // Vắng field → để nguyên (missing, không ghi log ồn ào).
  }
  if (hasEn(current)) {
    report.skipped.push(path);
    return current;
  }
  const vi = readVi(current);
  const en = enByVi[vi];
  if (!en) {
    report.unmapped.push(`${path}: "${vi}"`);
    return current; // Giữ nguyên xi, không chuẩn hóa.
  }
  report.converted.push(path);
  return { vi, en };
}

/** Backfill mảng highlights. */
function backfillHighlights(current, enByVi, report) {
  if (!Array.isArray(current)) {
    if (current !== undefined && current !== null) {
      report.unmapped.push(`highlights: (không phải mảng)`);
    }
    return current;
  }
  return current.map((h, i) => backfillText(h, enByVi, `highlights[${i}]`, report));
}

/** Backfill mảng quickFacts (label + value ghép độc lập). */
function backfillQuickFacts(current, labelMap, valueMap, report) {
  if (!Array.isArray(current)) {
    if (current !== undefined && current !== null) {
      report.unmapped.push(`quickFacts: (không phải mảng)`);
    }
    return current;
  }
  return current.map((fact, i) => {
    if (fact == null || typeof fact !== 'object') {
      report.unmapped.push(`quickFacts[${i}]: (không phải object)`);
      return fact;
    }
    const label = backfillText(fact.label, labelMap, `quickFacts[${i}].label`, report);
    const value = backfillText(fact.value, valueMap, `quickFacts[${i}].value`, report);
    return { ...fact, label, value };
  });
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
    const proj = await client.query(
      'SELECT id FROM projects WHERE slug = $1',
      [PROJECT_SLUG],
    );
    if (proj.rowCount === 0) {
      throw new Error(`Không tìm thấy dự án slug="${PROJECT_SLUG}".`);
    }
    const projectId = proj.rows[0].id;

    const targetSlugs = Object.keys(ITEMS);
    const res = await client.query(
      `SELECT id, slug, description, highlights, quick_facts
         FROM project_items
        WHERE project_id = $1 AND slug = ANY($2::text[])`,
      [projectId, targetSlugs],
    );

    const foundSlugs = new Set(res.rows.map((r) => r.slug));
    for (const slug of targetSlugs) {
      if (!foundSlugs.has(slug)) {
        console.log(`⚠️  Không tìm thấy hạng mục slug="${slug}" — bỏ qua.`);
      }
    }

    let totalConverted = 0;
    const writes = [];

    for (const row of res.rows) {
      const cfg = ITEMS[row.slug];
      const report = { converted: [], skipped: [], unmapped: [] };

      const nextDescription = backfillText(
        row.description,
        cfg.description,
        'description',
        report,
      );
      const nextHighlights = backfillHighlights(
        row.highlights,
        cfg.highlights,
        report,
      );
      const nextQuickFacts = backfillQuickFacts(
        row.quick_facts,
        cfg.quickFactLabels,
        cfg.quickFactValues,
        report,
      );

      // In tóm tắt từng hạng mục.
      console.log(`\n▶ ${row.slug}`);
      console.log(
        `   chuyển song ngữ: ${report.converted.length}` +
          (report.converted.length ? ` — ${report.converted.join(', ')}` : ''),
      );
      console.log(
        `   đã có EN (bỏ qua): ${report.skipped.length}` +
          (report.skipped.length ? ` — ${report.skipped.join(', ')}` : ''),
      );
      console.log(
        `   chưa map / thiếu:  ${report.unmapped.length}` +
          (report.unmapped.length ? ` — ${report.unmapped.join('; ')}` : ''),
      );

      if (report.converted.length > 0) {
        totalConverted += report.converted.length;
        writes.push({
          id: row.id,
          slug: row.slug,
          description: nextDescription,
          highlights: nextHighlights,
          quick_facts: nextQuickFacts,
        });
      }
    }

    console.log(
      `\nTổng: ${totalConverted} field chuyển song ngữ trên ${writes.length}/${res.rowCount} hạng mục.`,
    );

    if (totalConverted === 0) {
      console.log('✅ Không có thay đổi (đã song ngữ sẵn hoặc không map được).');
      return;
    }

    if (dryRun) {
      console.log('\n[DRY-RUN] Không ghi DB. Giá trị dự kiến của các hạng mục sẽ đổi:');
      for (const w of writes) {
        console.log(`  — ${w.slug}:`);
        console.log(`      description = ${JSON.stringify(w.description)}`);
        console.log(`      highlights  = ${JSON.stringify(w.highlights)}`);
        console.log(`      quickFacts  = ${JSON.stringify(w.quick_facts)}`);
      }
      return;
    }

    for (const w of writes) {
      await client.query(
        `UPDATE project_items
            SET description = $1::jsonb, highlights = $2::jsonb, quick_facts = $3::jsonb, updated_at = now()
          WHERE id = $4`,
        [
          JSON.stringify(w.description),
          JSON.stringify(w.highlights),
          JSON.stringify(w.quick_facts),
          w.id,
        ],
      );
    }
    console.log(
      `\n✅ Đã cập nhật ${writes.length} hạng mục (${totalConverted} field song ngữ) cho ${PROJECT_SLUG}.`,
    );
  } finally {
    await client.end();
  }
}

// Chỉ tự chạy khi gọi trực tiếp (`node prisma/backfill-project-items.js`).
// Khi được `require()` (vd. harness kiểm thử offline) thì chỉ export hàm thuần,
// không kết nối DB.
if (require.main === module) {
  main().catch((error) => {
    console.error(
      '❌ Backfill hạng mục thất bại:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
}

module.exports = {
  ITEMS,
  readVi,
  hasEn,
  backfillText,
  backfillHighlights,
  backfillQuickFacts,
};
