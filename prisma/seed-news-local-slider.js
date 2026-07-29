/**
 * Seed tin tức GIẢ dùng để kiểm slider trang chủ ở MÁY CỤC BỘ.
 *
 * Vì sao cần: slider chỉ hiện nút prev/next khi số bài đã đăng NHIỀU HƠN số thẻ
 * nhìn thấy (desktop = 3). DB dev hiện chỉ có vài bài PUBLISHED nên trên desktop
 * khối tin trông y hệt lưới tĩnh — đúng thiết kế, nhưng không kiểm được slider.
 *
 * An toàn:
 * - **Cầu chì cứng**: chỉ chạy khi DATABASE_URL trỏ `localhost`/`127.0.0.1` VÀ
 *   tên database nằm trong danh sách cho phép. Trỏ render.com → HỦY ngay.
 * - Slug mang tiền tố `local-slider-demo-` nên không bao giờ đụng bài thật.
 * - `publishedAt` tất định (không dùng `now()`), thứ tự hiển thị luôn giống nhau.
 * - Idempotent: chạy lại nhiều lần vẫn ra đúng 6 bản ghi đó.
 *
 * Chạy:   npm run prisma:seed:news:local-slider
 * Xóa:    npm run prisma:seed:news:local-slider -- --clean
 */
require('dotenv/config');
const { Client } = require('pg');

/** Database cục bộ được phép ghi. Ngoài danh sách này là HỦY. */
const ALLOWED_DATABASES = ['thien_duc_test', 'thien_duc_dev', 'thien_duc'];

const SLUG_PREFIX = 'local-slider-demo-';
const CATEGORY_SLUG = 'tin-cong-ty';

/**
 * 6 bài — đủ vượt ngưỡng 3 thẻ của desktop để nút prev/next hiện ra, và vẫn
 * dưới `HOME_NEWS_LIMIT` (8) của trang chủ.
 *
 * `publishedAt` cố định, cách nhau 1 ngày, giảm dần: bài 1 mới nhất nên trang
 * chủ luôn mở đầu bằng "… số 1".
 */
const posts = Array.from({ length: 6 }, (_, index) => {
  const number = index + 1;
  const day = String(20 - index).padStart(2, '0');
  return {
    slug: `${SLUG_PREFIX}${number}`,
    title: {
      vi: `[LOCAL] Tin kiểm thử slider số ${number}`,
      en: `[LOCAL] Slider test article ${number}`,
    },
    summary: {
      vi: `Bản ghi giả dùng để kiểm slider trang chủ ở máy cục bộ (số ${number}).`,
      en: `Local-only fixture used to verify the homepage slider (item ${number}).`,
    },
    content: [
      {
        vi: `Nội dung mẫu của bài số ${number}. Bản ghi này chỉ tồn tại ở máy cục bộ.`,
        en: `Sample content for article ${number}. This record exists locally only.`,
      },
    ],
    image: '/images/news/legacy/tin-tuc-thien-duc-placeholder-01.jpg',
    publishedAt: `2026-06-${day}T03:00:00.000Z`,
  };
});

function assertLocalDatabase(databaseUrl) {
  if (!databaseUrl) {
    throw new Error('Thiếu DATABASE_URL — seed này chỉ chạy trên DB cục bộ.');
  }
  if (/render\.com/i.test(databaseUrl)) {
    throw new Error(
      'DATABASE_URL trỏ tới render.com (production) — HỦY. Seed này chỉ dành cho máy cục bộ.',
    );
  }

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL không phải URL hợp lệ.');
  }

  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(
      `Host DB phải là localhost/127.0.0.1, nhận "${url.hostname}" — HỦY.`,
    );
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!ALLOWED_DATABASES.includes(database)) {
    throw new Error(
      `Database "${database}" không nằm trong danh sách cục bộ cho phép ` +
        `(${ALLOWED_DATABASES.join(', ')}) — HỦY.`,
    );
  }

  return { host: url.hostname, port: url.port || '5432', database };
}

async function main() {
  const meta = assertLocalDatabase(process.env.DATABASE_URL);
  const clean = process.argv.includes('--clean');
  console.log(
    `🔒 DB cục bộ: ${meta.host}:${meta.port}/${meta.database} (không phải production)`,
  );

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    if (clean) {
      const removed = await client.query(
        'DELETE FROM news_posts WHERE slug LIKE $1',
        [`${SLUG_PREFIX}%`],
      );
      console.log(`🧹 Đã xóa ${removed.rowCount} bài kiểm thử cục bộ.`);
      return;
    }

    // Chuyên mục có sẵn từ seed chính; thiếu thì bài vẫn tạo được với category null.
    const category = await client.query(
      'SELECT id FROM news_categories WHERE slug = $1',
      [CATEGORY_SLUG],
    );
    const categoryId = category.rows[0]?.id ?? null;

    for (const post of posts) {
      await client.query(
        `INSERT INTO news_posts
           (id, slug, category_id, title, summary, content, author, image,
            published_at, status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8,
                 'PUBLISHED', now(), now())
         ON CONFLICT (slug) DO UPDATE SET
           category_id  = EXCLUDED.category_id,
           title        = EXCLUDED.title,
           summary      = EXCLUDED.summary,
           content      = EXCLUDED.content,
           image        = EXCLUDED.image,
           published_at = EXCLUDED.published_at,
           status       = 'PUBLISHED',
           updated_at   = now()`,
        [
          post.slug,
          categoryId,
          JSON.stringify(post.title),
          JSON.stringify(post.summary),
          JSON.stringify(post.content),
          'Thiên Đức (local fixture)',
          post.image,
          post.publishedAt,
        ],
      );
    }

    const total = await client.query(
      "SELECT count(*)::int AS n FROM news_posts WHERE status = 'PUBLISHED'",
    );
    console.log(`✅ Đã seed ${posts.length} bài kiểm thử (PUBLISHED).`);
    console.log(`📊 Tổng bài PUBLISHED trong DB: ${total.rows[0].n}`);
    console.log(
      '   Desktop cần > 3 bài để nút prev/next hiện ra; tablet > 2; mobile > 1.',
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('❌', error.message);
  process.exit(1);
});
