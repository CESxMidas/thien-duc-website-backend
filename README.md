# thien-duc-website-backend

Backend NestJS + Prisma + PostgreSQL cho website Thiên Đức (PA2). Xem kế hoạch tổng ở
`../thien-duc-website-docs/docs/04-implementation/implementation-plan.md` và các câu hỏi chờ công ty xác nhận ở
`../thien-duc-website-docs/docs/01-requirements/open-questions.md`. Quy ước code dùng chung cho
frontend / admin / backend: `../AGENTS.md`.

## Modules

`auth`, `users`, `projects` (+ `project_items`, `project_gallery`), `news` (+ `news_categories`),
`pages`, `banners`, `contact`, `media` — theo ERD 12 bảng ở Sprint 0.

Nội dung song ngữ (title/summary/description/...) lưu dạng JSON `{ vi: string; en?: string }` để sẵn
sàng cho Sprint 4 (song ngữ) mà không cần đổi schema.

## Bắt đầu

```bash
cp .env.example .env   # điền DATABASE_URL, JWT_ACCESS_SECRET thật
npm install
npx prisma migrate dev --name init
npm run start:dev
```

- API: `http://localhost:3001/api`
- Swagger: `http://localhost:3001/api/docs`

Postgres local chạy bằng Docker ở **port 5433** (`docker compose up -d`) vì máy dev
đã có Postgres Windows chiếm 5432.

> ⚠️ Nối DB từ ngoài Render **bắt buộc** có `?sslmode=require` trong `DATABASE_URL`
> (adapter `@prisma/adapter-pg` không tự bật SSL) — thiếu là mọi route chạm DB trả
> `500` với thông báo đánh lạc hướng. Prisma CLI vẫn chạy được nên đừng lấy nó làm
> bằng chứng DB ổn. Chi tiết: `../thien-duc-website-docs/docs/07-deployment/deployment-guide.md`.

## Quy ước

- Response envelope thống nhất: `{success, data, message}` /
  `{success:false, error:{code, message, details}}` — xem `common/interceptors/`
  và `common/filters/`.
- `ValidationPipe` bật `whitelist` + `forbidNonWhitelisted`: field không có trong
  DTO bị **reject 400** chứ không bị bỏ qua.
- Route công khai chỉ trả nội dung `PUBLISHED`; bản `DRAFT`/`PENDING` đi qua
  `GET /<module>/admin` có `JwtAuthGuard` + `RolesGuard`.
- Slug trùng trả `409`, không để rơi thành `500`.

## Việc còn thiếu, chờ input công ty

- SMTP thật cho thông báo form liên hệ — câu 9. (`contact.service.ts` còn TODO
  gửi mail; phần lưu DB + rate-limit 5 req/IP/giờ đã chạy.)
- ~~Cloudinary~~ **đã xong** (câu 12): cloud name `thienduc`, `POST /media/upload`
  ép WebP + giới hạn 1200px, `DELETE /media/:id` xóa trên cloud trước.
- ~~Hosting/DB~~ **đã chốt** (câu 11): Render (BE + Postgres) + Vercel (FE).

## Script

- `npm run start:dev` — chạy dev với watch mode.
- `npm run build` — build production (`dist/`).
- `npm run lint` — eslint (auto-fix).
- `npm run test` / `npm run test:e2e` — unit / e2e test (e2e cần DB Postgres chạy sẵn).
- `npm run prisma:seed` — tạo tài khoản `SUPER_ADMIN` đầu tiên.
- `npm run prisma:seed:projects` / `prisma:seed:news` — seed dữ liệu thật (idempotent).
- `npx prisma studio` — xem/sửa dữ liệu qua UI.
