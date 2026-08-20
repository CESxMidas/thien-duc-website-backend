import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreatePageDto } from './create-page.dto';
import { UpdatePageDto } from './update-page.dto';

/**
 * **Ranh giới ghi của trang nội dung — ba cột xuất bản phải đóng ở tầng DTO.**
 *
 * `POST /pages` và `PATCH /pages/:slug` mở cho EDITOR (xem `@Roles` ở
 * `pages.controller.ts`), còn service thì spread thẳng `...dto` xuống Prisma.
 * Nên bất cứ field nào lọt vào DTO cũng ghi được xuống DB. Với `status` đó là
 * đường đăng bài tắt (bỏ qua `assertContentStatusTransition`); với
 * `scheduledAt`/`publishedAt` (Batch 11) đó là đường tự hẹn giờ đăng, bỏ qua
 * chốt ADMIN+ của `PATCH :slug/schedule`.
 *
 * Chốt chặn là sự VẮNG MẶT của field trong DTO, cộng `forbidNonWhitelisted` của
 * ValidationPipe. Kiểu vá đó rất dễ bị vô hiệu hoá bởi một lần "thêm lại field
 * cho tiện", nên phải có test khoá lại.
 *
 * Test chạy ValidationPipe THẬT với đúng cấu hình ở `main.ts` — chính bộ ba
 * option đó mới biến "field lạ" thành 400.
 */

/** Đúng cấu hình pipe toàn cục ở `src/main.ts`. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const validPage = {
  slug: 'gioi-thieu',
  title: { vi: 'Giới thiệu', en: 'About' },
  content: [{ vi: 'Nội dung.', en: 'Content.' }],
};

const PUBLICATION_FIELDS: [string, unknown][] = [
  ['status', 'PUBLISHED'],
  ['scheduledAt', '2026-08-20T08:00:00+07:00'],
  ['publishedAt', '2026-08-20T08:00:00+07:00'],
];

describe('Trang nội dung — ba cột xuất bản không ghi được qua API nội dung', () => {
  describe.each([
    ['CreatePageDto (POST /pages)', CreatePageDto],
    ['UpdatePageDto (PATCH /pages/:slug)', UpdatePageDto],
  ])('%s', (_label, metatype) => {
    it.each(PUBLICATION_FIELDS)(
      'từ chối payload có `%s`',
      async (field, value) => {
        await expect(
          pipe.transform(
            { ...validPage, [field]: value },
            { type: 'body', metatype },
          ),
        ).rejects.toMatchObject({ status: 400 });
      },
    );
  });

  /**
   * Đúng hình dạng request khai thác: EDITOR gửi MỖI field xuất bản qua PATCH,
   * không kèm nội dung nào khác.
   */
  it.each(PUBLICATION_FIELDS)(
    'payload khai thác thật (chỉ mỗi `%s`, qua PATCH) bị chặn ở tầng 400',
    async (field, value) => {
      await expect(
        pipe.transform(
          { [field]: value },
          { type: 'body', metatype: UpdatePageDto },
        ),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it('cả ba cùng lúc → 400, nêu đích danh từng field', async () => {
    expect.assertions(3);
    try {
      await pipe.transform(
        {
          ...validPage,
          status: 'PUBLISHED',
          scheduledAt: '2026-08-20T08:00:00+07:00',
          publishedAt: '2026-08-20T08:00:00+07:00',
        },
        { type: 'body', metatype: UpdatePageDto },
      );
    } catch (error) {
      const response = (
        error as { getResponse(): { message: string[] } }
      ).getResponse();
      const message = response.message.join(' ');
      expect(message).toContain('status');
      expect(message).toContain('scheduledAt');
      expect(message).toContain('publishedAt');
    }
  });

  /** Chốt này KHÔNG được vơ đũa cả nắm: nội dung hợp lệ vẫn phải đi qua. */
  it('payload hợp lệ KHÔNG có field xuất bản vẫn qua như cũ', async () => {
    await expect(
      pipe.transform(validPage, { type: 'body', metatype: CreatePageDto }),
    ).resolves.toMatchObject({ slug: 'gioi-thieu' });
  });

  it('sửa nội dung thông thường (tiêu đề, đoạn văn) không bị chặn oan', async () => {
    await expect(
      pipe.transform(
        { title: { vi: 'Tiêu đề mới' }, content: [{ vi: 'Đoạn mới.' }] },
        { type: 'body', metatype: UpdatePageDto },
      ),
    ).resolves.toMatchObject({ title: { vi: 'Tiêu đề mới' } });
  });

  it.each(PUBLICATION_FIELDS)(
    'field `%s` không tồn tại trên DTO (không phải chỉ bị bỏ qua ở service)',
    (field, value) => {
      const instance = plainToInstance(CreatePageDto, {
        ...validPage,
        [field]: value,
      });

      // `whitelistValidation` chỉ nổ khi property KHÔNG có decorator validate
      // nào — tức DTO thật sự không khai báo field.
      const errors = validateSync(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.some((error) => error.property === field)).toBe(true);
    },
  );
});
