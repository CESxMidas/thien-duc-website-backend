# Backend API — Thiên Đức

Quy ước dùng chung cho cả frontend, admin và backend nằm ở `../AGENTS.md` — đọc
file đó trước (response envelope, field song ngữ `{vi, en?}`, enum Prisma, quy
trình lint/build). Chỉ thêm vào đây quy tắc riêng của backend.

File cha **chỉ tồn tại trong workspace nhiều repo**; clone riêng repo này sẽ
không có nó. Đó là trường hợp được hỗ trợ: mục dưới đây đủ để làm việc an toàn
với backend một mình, còn `../AGENTS.md` là phần bổ sung khi có.

@../AGENTS.md

## Quy tắc tối thiểu khi chỉ có repo này

- **Không tự ý `git commit` / `git push`** khi người dùng chưa yêu cầu.
- **E2E chỉ chạy trên DB cách ly.** `npm run test:e2e` tự gọi
  `prisma/preflight-e2e.js` (chạy riêng: `npm run e2e:preflight`) — preflight bắt
  buộc `DATABASE_URL` trỏ đúng DB `thien_duc_test` ở `localhost`/`127.0.0.1`. Đừng
  vô hiệu hoá hay nới lỏng cầu chì đó để test chạy được; E2E ghi và xoá dữ liệu
  thật nên không bao giờ được chạm DB từ xa.
- **Secret chỉ ở phía server.** Không đặt tiền tố `NEXT_PUBLIC_` / `VITE_` cho bất
  kỳ secret nào — tiền tố đó đưa giá trị vào bundle client của frontend/admin.
- **Trước khi báo xong**: `npm run lint` và `npx tsc --noEmit` phải sạch lỗi, chạy
  `npm run test` khi có sửa code có test. CI chạy lint, build, unit test và e2e.
