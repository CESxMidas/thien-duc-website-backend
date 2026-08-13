import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateNewsPostDto } from './create-news-post.dto';
import { UpdateNewsPostDto } from './update-news-post.dto';

/**
 * Hồi quy bảo mật — **đường ghi `scheduledAt` qua API nội dung chung phải đóng.**
 *
 * Lỗ hổng đã có trước batch này: `POST /news` và `PATCH /news/:slug` mở cho
 * EDITOR (xem `@Roles` ở `news.controller.ts`), nhưng `CreateNewsPostDto` lại
 * nhận `scheduledAt` mà không kiểm vai trò và không kiểm thời điểm. EDITOR chỉ
 * được đi `DRAFT → PENDING` qua `assertContentStatusTransition`, nhưng chỉ cần
 * gửi kèm `scheduledAt` ở quá khứ là `NewsSchedulerService` đăng bài giúp trong
 * vòng 5 phút — leo thang quyền, bỏ qua trọn vẹn luồng duyệt.
 *
 * Chốt chặn là sự VẮNG MẶT của field trong DTO, cộng với `forbidNonWhitelisted`
 * của ValidationPipe. Kiểu vá đó rất dễ bị vô hiệu hoá bởi một lần "thêm lại
 * field cho tiện", nên phải có test khoá lại.
 *
 * Test chạy ValidationPipe THẬT với đúng cấu hình ở `main.ts` (whitelist +
 * forbidNonWhitelisted + transform) chứ không chỉ `validateSync` — chính bộ ba
 * option đó mới là thứ biến "field lạ" thành 400.
 */

/** Đúng cấu hình pipe toàn cục ở `src/main.ts`. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const validPost = {
  slug: 'bai-viet-moi',
  title: { vi: 'Tiêu đề', en: 'Title' },
  summary: { vi: 'Tóm tắt bài viết', en: 'Summary' },
};

const SCHEDULED_AT = '2026-08-20T01:00:00.000Z';

describe('scheduledAt không ghi được qua API nội dung chung (hồi quy bảo mật)', () => {
  it.each([
    ['CreateNewsPostDto (POST /news)', CreateNewsPostDto],
    ['UpdateNewsPostDto (PATCH /news/:slug)', UpdateNewsPostDto],
  ])('%s từ chối payload có scheduledAt', async (_label, metatype) => {
    await expect(
      pipe.transform(
        { ...validPost, scheduledAt: SCHEDULED_AT },
        { type: 'body', metatype },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('thông báo lỗi chỉ đích danh `scheduledAt` (không phải lỗi mơ hồ)', async () => {
    expect.assertions(1);
    try {
      await pipe.transform(
        { ...validPost, scheduledAt: SCHEDULED_AT },
        { type: 'body', metatype: CreateNewsPostDto },
      );
    } catch (error) {
      const response = (
        error as { getResponse(): { message: string[] } }
      ).getResponse();
      expect(response.message.join(' ')).toContain('scheduledAt');
    }
  });

  it('payload hợp lệ KHÔNG có scheduledAt vẫn qua như cũ', async () => {
    await expect(
      pipe.transform(validPost, {
        type: 'body',
        metatype: CreateNewsPostDto,
      }),
    ).resolves.toMatchObject({ slug: 'bai-viet-moi' });
  });

  it('`eventDate` vẫn ghi được — chốt này không vơ đũa cả nắm các field ngày', async () => {
    await expect(
      pipe.transform(
        { ...validPost, eventDate: '2026-03-31' },
        { type: 'body', metatype: CreateNewsPostDto },
      ),
    ).resolves.toMatchObject({ eventDate: '2026-03-31' });
  });

  it('field `scheduledAt` không còn tồn tại trên DTO (không phải chỉ bị đánh dấu optional)', () => {
    const instance = plainToInstance(CreateNewsPostDto, {
      ...validPost,
      scheduledAt: SCHEDULED_AT,
    });

    // `whitelistValidation` chỉ nổ khi property KHÔNG có decorator validate nào
    // — tức là DTO thật sự không khai báo field, chứ không phải khai báo rồi bỏ
    // qua ở tầng service.
    const errors = validateSync(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((error) => error.property === 'scheduledAt')).toBe(true);
  });
});
