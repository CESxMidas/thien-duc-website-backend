// Import 18 bài tin tức thu thập từ website hiện hành thienduccons.vn
// (2 trang /tin-tuc/) vào bảng news_categories + news_posts. Idempotent —
// chạy lại nhiều lần vẫn an toàn nhờ ON CONFLICT (slug) DO UPDATE.
//
// Nguồn: docs/01-requirements/open-questions.md câu 3 — công ty xác nhận ngoài
// bài "Lễ khởi công Fancy Tower" thì có thể tự phân tích thêm để có dữ liệu.
// Toàn bộ nội dung ở đây là bài đã đăng công khai trên site của công ty, không
// phải dữ liệu bịa.
//
// Dữ liệu nằm ở news-thienduccons-import.json (tách khỏi code để dễ rà soát).
// Trạng thái mặc định là DRAFT: 13/18 bài là bài đăng lại từ báo ngoài
// (Báo Xây dựng, Trí thức trẻ, designs.vn…) nên cần người duyệt trước khi
// xuất bản. Đặt NEWS_IMPORT_STATUS=PUBLISHED nếu muốn xuất bản ngay.
//
// Chạy:  npm run prisma:seed:news:thienduccons
require('dotenv/config');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

/** Field song ngữ: chỉ có tiếng Việt, bản tiếng Anh bổ sung sau. */
const vi = (text) => ({ vi: text });

/** `content` là mảng đoạn văn, mỗi đoạn là một field song ngữ. */
const paragraphs = (texts) => JSON.stringify(texts.map(vi));

const categories = [
  { slug: 'tin-du-an', name: 'Tin dự án', order: 0 },
  { slug: 'tin-cong-ty', name: 'Tin công ty', order: 1 },
  { slug: 'tin-thi-truong', name: 'Tin thị trường', order: 2 },
  { slug: 'tin-kien-truc', name: 'Kiến trúc & Xây dựng', order: 3 },
];

const posts = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'news-thienduccons-import.json'),
    'utf8',
  ),
);

const STATUS = process.env.NEWS_IMPORT_STATUS === 'PUBLISHED'
  ? 'PUBLISHED'
  : 'DRAFT';

async function main() {
  const useSsl = /\brender\.com\b/.test(process.env.DATABASE_URL ?? '');

  // `.env` của máy dev có thể đang trỏ vào Render (production). Import ghi đè
  // nội dung tin tức nên phải xác nhận có chủ ý.
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
    const categoryId = categoryIds.get(post.categorySlug);
    if (!categoryId) {
      throw new Error(
        `Bài "${post.slug}" trỏ vào chuyên mục không tồn tại: ${post.categorySlug}`,
      );
    }

    await client.query(
      `INSERT INTO news_posts
         (id, slug, category_id, title, summary, content, author, image,
          published_at, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9,
               now(), now())
       ON CONFLICT (slug) DO UPDATE
         SET category_id = EXCLUDED.category_id,
             title = EXCLUDED.title,
             summary = EXCLUDED.summary,
             content = EXCLUDED.content,
             author = EXCLUDED.author,
             image = EXCLUDED.image,
             published_at = EXCLUDED.published_at,
             status = EXCLUDED.status,
             updated_at = now()`,
      [
        post.slug,
        categoryId,
        JSON.stringify(vi(post.title)),
        JSON.stringify(vi(post.summary)),
        paragraphs(post.content),
        post.author,
        post.image,
        post.publishedAt,
        STATUS,
      ],
    );
  }
  console.log(`✅ Tin tức: ${posts.length} bản ghi (status = ${STATUS})`);

  await client.end();
}

main().catch((error) => {
  console.error(
    '❌ Import thất bại:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
