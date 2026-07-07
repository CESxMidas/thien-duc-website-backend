# thien-duc-website-backend

Backend NestJS + Prisma + PostgreSQL cho website Thiên Đức (PA2). Xem kế hoạch tổng ở
`../docs/KE-HOACH-CODING.md` và các câu hỏi chờ công ty xác nhận ở
`../docs/CAU-HOI-CAN-XAC-NHAN.md`.

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

## Việc còn thiếu, chờ input công ty

- Cloudinary (upload media thật) — câu 12.
- SMTP thật cho thông báo form liên hệ — câu 9.
- Nhà cung cấp hosting/DB staging — câu 11.

## Script

- `npm run start:dev` — chạy dev với watch mode.
- `npm run build` — build production (`dist/`).
- `npm run lint` — eslint (auto-fix).
- `npm run test` / `npm run test:e2e` — unit / e2e test (e2e cần DB Postgres chạy sẵn).
- `npx prisma studio` — xem/sửa dữ liệu qua UI.
