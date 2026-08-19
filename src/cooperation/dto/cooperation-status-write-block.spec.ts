import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateCooperationProjectDto } from './create-cooperation-project.dto';
import { UpdateCooperationProjectDto } from './update-cooperation-project.dto';

/**
 * Hồi quy bảo mật — **đường ghi `contentStatus` qua API nội dung chung phải đóng.**
 *
 * Lỗ hổng đã có trước batch này: `POST /cooperation` và `PATCH /cooperation/:id`
 * mở cho EDITOR (xem `@Roles` ở `cooperation.controller.ts`), nhưng
 * `CreateCooperationProjectDto` lại khai báo `contentStatus`, và
 * `UpdateCooperationProjectDto` thừa hưởng nó qua `PartialType`. Service thì
 * spread thẳng `...dto` xuống Prisma trong `update()`, không kiểm vai trò và
 * không đi qua `assertContentStatusTransition`.
 *
 * Kết quả: một EDITOR chỉ cần gửi `{"contentStatus":"PUBLISHED"}` qua route sửa
 * nội dung là dự án hợp tác lên thẳng trang chủ — leo thang quyền, bỏ qua trọn
 * vẹn luồng duyệt. (Route `POST` thoát nạn nhờ `create()` ghi đè giá trị SAU
 * khi spread, nhưng phòng thủ dựa vào *thứ tự các dòng* thì quá mong manh.)
 *
 * Chốt chặn là sự VẮNG MẶT của field trong DTO, cộng `forbidNonWhitelisted` của
 * ValidationPipe. Kiểu vá đó rất dễ bị vô hiệu hoá bởi một lần "thêm lại field
 * cho tiện", nên phải có test khoá lại.
 *
 * Test chạy ValidationPipe THẬT với đúng cấu hình ở `main.ts` chứ không chỉ
 * `validateSync` — chính bộ ba option đó mới biến "field lạ" thành 400.
 */

/** Đúng cấu hình pipe toàn cục ở `src/main.ts`. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const bilingual = (vi: string) => ({ vi, en: vi });

/** Payload hợp lệ tối thiểu cho một dự án hợp tác. */
const validProject = {
  name: bilingual('Khu đô thị hợp tác'),
  location: bilingual('Bến Tre'),
  role: bilingual('Đồng phát triển'),
  partner: bilingual('Đối tác'),
  scale: bilingual('10 ha'),
  // CHÚ Ý: `status` này là trạng thái mô tả bằng chữ, KHÔNG phải ContentStatus.
  status: bilingual('Đang triển khai'),
};

describe('contentStatus không ghi được qua API nội dung chung (hồi quy bảo mật)', () => {
  it.each([
    [
      'CreateCooperationProjectDto (POST /cooperation)',
      CreateCooperationProjectDto,
    ],
    [
      'UpdateCooperationProjectDto (PATCH /cooperation/:id)',
      UpdateCooperationProjectDto,
    ],
  ])('%s từ chối payload có contentStatus', async (_label, metatype) => {
    await expect(
      pipe.transform(
        { ...validProject, contentStatus: 'PUBLISHED' },
        { type: 'body', metatype },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  /**
   * Đúng hình dạng request khai thác: EDITOR gửi MỖI `contentStatus` qua PATCH,
   * không kèm nội dung nào khác. Trước bản vá, ValidationPipe cho payload này
   * đi qua nguyên vẹn và `update()` ghi thẳng xuống DB.
   */
  it('payload khai thác thật (chỉ mỗi contentStatus, qua PATCH) bị chặn ở tầng 400', async () => {
    await expect(
      pipe.transform(
        { contentStatus: 'PUBLISHED' },
        { type: 'body', metatype: UpdateCooperationProjectDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('thông báo lỗi chỉ đích danh `contentStatus` (không phải lỗi mơ hồ)', async () => {
    expect.assertions(1);
    try {
      await pipe.transform(
        { ...validProject, contentStatus: 'PUBLISHED' },
        { type: 'body', metatype: CreateCooperationProjectDto },
      );
    } catch (error) {
      const response = (
        error as { getResponse(): { message: string[] } }
      ).getResponse();
      expect(response.message.join(' ')).toContain('contentStatus');
    }
  });

  it('payload hợp lệ KHÔNG có contentStatus vẫn qua như cũ', async () => {
    await expect(
      pipe.transform(validProject, {
        type: 'body',
        metatype: CreateCooperationProjectDto,
      }),
    ).resolves.toMatchObject({ name: { vi: 'Khu đô thị hợp tác' } });
  });

  /**
   * Chốt này KHÔNG được vơ đũa cả nắm: `status` (chữ mô tả, song ngữ) là nội
   * dung biên tập bình thường, EDITOR phải sửa được. Nhầm hai field là vừa mở
   * lại lỗ hổng vừa chặn mất việc chính đáng.
   */
  it('`status` mô tả bằng chữ vẫn ghi được — không nhầm với contentStatus', async () => {
    await expect(
      pipe.transform(
        { ...validProject, status: bilingual('Đã bàn giao') },
        { type: 'body', metatype: UpdateCooperationProjectDto },
      ),
    ).resolves.toMatchObject({ status: { vi: 'Đã bàn giao' } });
  });

  it('sửa nội dung thông thường (tên, ảnh, thứ tự) không bị chặn oan', async () => {
    await expect(
      pipe.transform(
        { name: bilingual('Tên mới'), image: '/images/a.jpg', order: 3 },
        { type: 'body', metatype: UpdateCooperationProjectDto },
      ),
    ).resolves.toMatchObject({ order: 3 });
  });

  /* ---------------------------------------------------------------------
     Batch 10 — hai cột mốc lịch đăng chịu ĐÚNG chốt chặn đó.

     `publishedAt` và `scheduledAt` là cột do SERVER sở hữu y như
     `contentStatus`: ai ghi được chúng qua route nội dung thì ghi được cả thời
     điểm nội dung ra công khai. Lệnh hợp lệ duy nhất là
     `PATCH /cooperation/:id/schedule` (chốt `@Roles(ADMIN, SUPER_ADMIN)`).

     Chốt chặn vẫn là sự VẮNG MẶT của field trong DTO cộng `forbidNonWhitelisted`
     — nên nó cũng dễ bị vô hiệu hoá bởi một lần "thêm cho tiện" y như cũ.
     --------------------------------------------------------------------- */

  it.each([
    [
      'CreateCooperationProjectDto (POST /cooperation)',
      CreateCooperationProjectDto,
    ],
    [
      'UpdateCooperationProjectDto (PATCH /cooperation/:id)',
      UpdateCooperationProjectDto,
    ],
  ])('%s từ chối payload có scheduledAt', async (_label, metatype) => {
    await expect(
      pipe.transform(
        { ...validProject, scheduledAt: '2026-08-20T08:00:00+07:00' },
        { type: 'body', metatype },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    [
      'CreateCooperationProjectDto (POST /cooperation)',
      CreateCooperationProjectDto,
    ],
    [
      'UpdateCooperationProjectDto (PATCH /cooperation/:id)',
      UpdateCooperationProjectDto,
    ],
  ])('%s từ chối payload có publishedAt', async (_label, metatype) => {
    await expect(
      pipe.transform(
        { ...validProject, publishedAt: '2026-08-20T08:00:00+07:00' },
        { type: 'body', metatype },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  /**
   * Hình dạng khai thác thật: gửi MỖI `scheduledAt` qua PATCH để tự hẹn giờ
   * đăng cho bản nháp của mình, bỏ qua chốt ADMIN+ của route lịch.
   */
  it('payload khai thác thật (chỉ mỗi scheduledAt, qua PATCH) bị chặn ở tầng 400', async () => {
    await expect(
      pipe.transform(
        { scheduledAt: '2026-08-20T08:00:00+07:00' },
        { type: 'body', metatype: UpdateCooperationProjectDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('cả ba cột xuất bản cùng lúc → vẫn 400, và nêu đích danh từng field', async () => {
    expect.assertions(3);
    try {
      await pipe.transform(
        {
          ...validProject,
          contentStatus: 'PUBLISHED',
          scheduledAt: '2026-08-20T08:00:00+07:00',
          publishedAt: '2026-08-20T08:00:00+07:00',
        },
        { type: 'body', metatype: UpdateCooperationProjectDto },
      );
    } catch (error) {
      const response = (
        error as { getResponse(): { message: string[] } }
      ).getResponse();
      const message = response.message.join(' ');
      expect(message).toContain('contentStatus');
      expect(message).toContain('scheduledAt');
      expect(message).toContain('publishedAt');
    }
  });

  it.each(['scheduledAt', 'publishedAt'])(
    'field `%s` không tồn tại trên DTO (không phải chỉ bị bỏ qua ở service)',
    (field) => {
      const instance = plainToInstance(CreateCooperationProjectDto, {
        ...validProject,
        [field]: '2026-08-20T08:00:00+07:00',
      });

      const errors = validateSync(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.some((error) => error.property === field)).toBe(true);
    },
  );

  it('field `contentStatus` không còn tồn tại trên DTO (không phải chỉ bị bỏ qua ở service)', () => {
    const instance = plainToInstance(CreateCooperationProjectDto, {
      ...validProject,
      contentStatus: 'PUBLISHED',
    });

    // `whitelistValidation` chỉ nổ khi property KHÔNG có decorator validate nào
    // — tức DTO thật sự không khai báo field, chứ không phải khai báo rồi lọc ở
    // tầng service.
    const errors = validateSync(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((error) => error.property === 'contentStatus')).toBe(
      true,
    );
  });
});
