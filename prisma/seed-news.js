// Seed chuyên mục + tin tức (idempotent — chạy lại nhiều lần vẫn an toàn).
//
// Nguồn nội dung: docs/CAU-HOI-CAN-XAC-NHAN.md câu 3 — công ty xác nhận hiện
// mới có **một** tin thật ("Lễ khởi công Fancy Tower"). Không bịa thêm tin để
// lấp chỗ trống: trang tin hiển thị đúng những gì công ty đã duyệt.
//
// Chạy:  npm run prisma:seed:news
require('dotenv/config');
const { Client } = require('pg');

/** Field song ngữ: chỉ có tiếng Việt, bản tiếng Anh bổ sung ở Sprint 4. */
const vi = (text) => ({ vi: text });

/** `content` là mảng đoạn văn, mỗi đoạn là một field song ngữ. */
const paragraphs = (texts) => JSON.stringify(texts.map(vi));

const categories = [
  { slug: 'tin-du-an', name: 'Tin dự án', order: 0 },
  { slug: 'tin-cong-ty', name: 'Tin công ty', order: 1 },
  { slug: 'tin-thi-truong', name: 'Tin thị trường', order: 2 },
];

const posts = [
  {
    slug: 'le-khoi-cong-fancy-tower-khu-do-thi-hung-phu',
    categorySlug: 'tin-du-an',
    title: 'Lễ khởi công Fancy Tower | Khu đô thị Hưng Phú',
    summary:
      'Dự án chung cư cao cấp Fancy Tower chính thức khởi công ngày 31/03/2021 tại Khu đô thị Hưng Phú, với quy mô 1 tầng hầm và 19 tầng nổi.',
    content: [
      'Ngày 31/03/2021, dự án chung cư cao cấp Fancy Tower tại Khu đô thị Hưng Phú chính thức được khởi công.',
      'Công trình được giới thiệu với quy mô 1 tầng hầm và 19 tầng nổi, nằm trong định hướng phát triển không gian sống hiện đại tại khu đô thị.',
      'Thiên Đức sẽ tiếp tục cập nhật thông tin dự án trên website khi có thêm nội dung chính thức được duyệt.',
    ],
    author: 'Thiên Đức',
    image: '/images/news/2021/le-khoi-cong-fancy-tower-2021-04-07.jpg',
    eventDate: '2021-03-31',
    publishedAt: '2021-04-07',
  },
];

async function main() {
  const useSsl = /\brender\.com\b/.test(process.env.DATABASE_URL ?? '');

  // `.env` của máy dev đang trỏ vào Render (production). Seed ghi đè nội dung
  // tin tức nên phải xác nhận có chủ ý, không để lỡ tay chạy nhầm.
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

  const categoryIds = new Map();
  for (const category of categories) {
    const res = await client.query(
      `INSERT INTO news_categories (id, slug, name, "order")
       VALUES (gen_random_uuid(), $1, $2, $3)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name, "order" = EXCLUDED."order"
       RETURNING id`,
      [category.slug, JSON.stringify(vi(category.name)), category.order],
    );
    categoryIds.set(category.slug, res.rows[0].id);
  }
  console.log(`✅ Chuyên mục: ${categories.length} bản ghi`);

  for (const post of posts) {
    await client.query(
      `INSERT INTO news_posts
         (id, slug, category_id, title, summary, content, author, image,
          event_date, published_at, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9,
               'PUBLISHED', now(), now())
       ON CONFLICT (slug) DO UPDATE
         SET category_id = EXCLUDED.category_id,
             title = EXCLUDED.title,
             summary = EXCLUDED.summary,
             content = EXCLUDED.content,
             author = EXCLUDED.author,
             image = EXCLUDED.image,
             event_date = EXCLUDED.event_date,
             published_at = EXCLUDED.published_at,
             status = 'PUBLISHED',
             updated_at = now()`,
      [
        post.slug,
        categoryIds.get(post.categorySlug),
        JSON.stringify(vi(post.title)),
        JSON.stringify(vi(post.summary)),
        paragraphs(post.content),
        post.author,
        post.image,
        post.eventDate,
        post.publishedAt,
      ],
    );
  }
  console.log(`✅ Tin tức: ${posts.length} bản ghi`);

  await client.end();
}

main().catch((error) => {
  console.error(
    '❌ Seed thất bại:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
