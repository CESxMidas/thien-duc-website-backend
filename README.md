  # Thiên Đức — Backend API

NestJS 11 + Prisma 7 + PostgreSQL cho website và Admin CMS Thiên Đức.

## Local Development

### Yêu cầu

- Node.js **22.x LTS** (nguồn chuẩn: `.nvmrc` và `package.json#engines`).
- npm với `package-lock.json`; không dùng Yarn/pnpm.
- Docker Desktop/Compose để chạy PostgreSQL local, hoặc PostgreSQL tương thích.

```bash
nvm use
npm ci
cp .env.example .env
docker compose up -d
npm run prisma:generate
npx prisma migrate dev
npm run start:dev
```

PostgreSQL local: `localhost:5433`, database `thien_duc`. API:
`http://localhost:3001/api`; Swagger chỉ ở development:
`http://localhost:3001/api/docs`.

`.env.example` giải thích từng biến. Tối thiểu local cần `DATABASE_URL`,
`JWT_ACCESS_SECRET` và `CORS_ORIGIN`; Cloudinary, Resend và Sentry tùy tính năng.
Không dùng giá trị production trong file local và không commit `.env*` (trừ
`.env.example`).

### Recruitment positions

`/api/recruitment-positions` cung cấp danh sách vị trí đang tuyển cho website.
GET công khai chỉ trả trạng thái `PUBLISHED` với `deadline` còn hiệu lực (hạn
được tính hết ngày theo `Asia/Ho_Chi_Minh`). `deadline` là ngày thuần
`YYYY-MM-DD` hoặc `null` trong request và response.

Request `POST` và `PATCH` dùng `title`, `department`, `location`, `type`,
`summary` theo dạng `{ "vi": "…", "en": "…" }` (trường `en` tùy chọn).
`responsibilities`, `requirements`, `benefits` là object song ngữ với mảng
chuỗi theo ngôn ngữ: `{ "vi": ["…"], "en": ["…"] }` (`en` tùy chọn). Mọi field
văn bản song ngữ trong response giữ nguyên các shape này.

Các route dành cho Admin CMS:

| Method | Route | Quyền |
| --- | --- | --- |
| `GET` | `/api/recruitment-positions/admin` | EDITOR, ADMIN, SUPER_ADMIN |
| `GET` | `/api/recruitment-positions/admin/:id` | EDITOR, ADMIN, SUPER_ADMIN |
| `POST` | `/api/recruitment-positions` | EDITOR, ADMIN, SUPER_ADMIN |
| `PATCH` | `/api/recruitment-positions/:id` | EDITOR, ADMIN, SUPER_ADMIN |
| `DELETE` | `/api/recruitment-positions/:id` | ADMIN, SUPER_ADMIN |

Status dùng enum chung `DRAFT | PENDING | PUBLISHED`. Vị trí mới mặc định ở
`DRAFT`; EDITOR tạo được bản nháp, chỉ sửa được vị trí `DRAFT` và có thể gửi
duyệt bằng `PATCH` chuyển `DRAFT → PENDING`. EDITOR không thể đăng trực tiếp,
sửa nội dung đã gửi duyệt/đã đăng hoặc chuyển trạng thái lùi về. ADMIN và
SUPER_ADMIN có thể chọn bất kỳ status nào trong enum chung. Request và response
được Swagger mô tả tại `/api/docs`.

### Prisma và seed

```bash
npx prisma migrate dev --name <ten-migration>
npm run prisma:generate
npm run prisma:validate
npm run prisma:seed
npm run prisma:seed:projects
npm run prisma:seed:news
npm run prisma:seed:pages
npm run prisma:seed:banners
npm run prisma:seed:cooperation
```

`prisma:seed` tạo tài khoản bootstrap từ `ADMIN_EMAIL`/`ADMIN_PASSWORD`. Không
sửa migration đã áp dụng. Production dùng `npx prisma migrate deploy`, không
dùng `migrate reset`. Xem [quy trình migration](../thien-duc-website-docs/07-deployment/database-migrations.md).

### Kiểm tra và build

```bash
npm run lint
npm run lint:check
npm run typecheck
npm run test
npm run build
npm run prisma:validate
```

E2E chỉ được chạy với database local an toàn tên `thien_duc_test`, tuyệt đối
không trỏ vào production:

```bash
npm run e2e:preflight
npm run test:e2e
```

## CI/CD

GitHub Actions chạy khi push lên `main` và khi có pull request vào `main`:
`npm ci` → Prisma generate → lint không tự sửa → typecheck → unit test → build
→ Prisma validate. Job E2E riêng dựng PostgreSQL 17 dùng một lần, migrate/seed
dữ liệu test rồi chạy E2E.

CI chỉ xác thực mã, không dùng secret hay database production. Render vẫn triển
khai từ Git; việc provider có chờ CI hay không phụ thuộc cấu hình dashboard và
branch protection. Chi tiết: [CI/CD](../thien-duc-website-docs/07-deployment/ci-cd.md).

## Deployment / Handover

- Production API: `https://thien-duc-website-backend-w1du.onrender.com/api`.
- `render.yaml` khai nhánh `main`, `npm ci && npm run build`,
  `npx prisma migrate deploy && npm run start:prod` và health path `/api`.
- Render auto-deploy theo Git khi dashboard/Blueprint đang kết nối đúng.
- Kiểm tra sau deploy: `/api` và route công khai trả 200; `/api/users` không
  token trả 401; Swagger production trả 404.

Env production nhập tại Render, không nằm trong Git. Quy trình đầy đủ:
[deployment](../thien-duc-website-docs/07-deployment/deployment-guide.md),
[rollback](../thien-duc-website-docs/07-deployment/rollback-plan.md),
[backup/restore](../thien-duc-website-docs/07-deployment/backup-and-restore.md) và
[monitoring](../thien-duc-website-docs/07-deployment/monitoring-and-alerting.md).
