import { Prisma } from '../../generated/prisma/client';

/**
 * Ép **một field JSON** của DTO sang kiểu input JSON của Prisma.
 *
 * Lý do tồn tại: các cột `Json` (TranslatedTextDto, mảng đoạn song ngữ,
 * `Record<string, unknown>`, `unknown[]`) không **khớp cấu trúc** với
 * `Prisma.InputJsonValue` — chủ yếu vì prop optional `en?: string` sinh ra
 * `string | undefined` mà `InputJsonValue` không cho phép. Trước đây mỗi service
 * né bằng `dto as unknown as Prisma.*Input` (ép cả payload → **tắt toàn bộ**
 * kiểm tra kiểu, kể cả field scalar).
 *
 * Hàm này khoanh phần ép kiểu JSON về **một chỗ duy nhất** ở mức từng field, để
 * service có thể dựng payload `... satisfies Prisma.*Input` — trình biên dịch
 * vẫn kiểm tra mọi field scalar và bắt buộc bọc đúng các field JSON.
 *
 * **Runtime là identity** (không sao chép, không đổi giá trị) nên giữ nguyên
 * hành vi: giá trị `undefined`/`null`/`Prisma.DbNull` đi qua y hệt như cũ.
 */
export function json(value: object): Prisma.InputJsonValue;
export function json(
  value: object | null | undefined,
): Prisma.InputJsonValue | undefined;
export function json(
  value: object | null | undefined,
): Prisma.InputJsonValue | undefined {
  return value as unknown as Prisma.InputJsonValue | undefined;
}
