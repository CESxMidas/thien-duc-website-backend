import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateProjectDto } from '../../projects/dto/create-project.dto';
import { UpdateProjectDto } from '../../projects/dto/update-project.dto';
import { CreatePageDto } from '../../pages/dto/create-page.dto';
import { UpdatePageDto } from '../../pages/dto/update-page.dto';
import { ProjectStatus } from '../../../generated/prisma/client';

/**
 * **Kiểm lại biên DTO sau khi truyền vai trò xuống các service `update` (§35).**
 *
 * Batch 8 thêm một tham số `actorRole` vào bốn hàm `update()`. Việc đó không được
 * nới lỏng chốt cũ: payload nội dung vẫn KHÔNG được ghi trạng thái xuất bản.
 * News và Cooperation đã có spec riêng cho chốt này
 * (`news-schedule-write-block.spec.ts`, `cooperation-status-write-block.spec.ts`);
 * Project và Page thì chưa, nên phần còn thiếu của ma trận nằm ở đây.
 *
 * Chốt chặn là sự VẮNG MẶT của field trong DTO cộng `forbidNonWhitelisted` —
 * cùng cơ chế, cùng độ mong manh, nên cùng cần test khoá lại.
 *
 * Lưu ý về **chiều sâu phòng thủ**: `CooperationService.update()` và (từ Batch
 * 9) `ProjectsService.update()` còn ghi tường minh `undefined` cho các cột xuất
 * bản sau `...dto`, làm lớp chốt thứ hai. `PagesService.update()` thì KHÔNG —
 * trang nội dung chỉ có đúng một lớp là ValidationPipe, nên phần Page của spec
 * này chính là thứ canh lớp duy nhất ấy.
 */

/** Đúng cấu hình pipe toàn cục ở `src/main.ts`. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const bilingual = (vi: string) => ({ vi, en: vi });

const validProject = {
  slug: 'du-an-moi',
  title: bilingual('Dự án'),
  summary: bilingual('Tóm tắt dự án'),
  status: ProjectStatus.DANG_THI_CONG,
};

const validPage = {
  slug: 'gioi-thieu',
  title: bilingual('Giới thiệu'),
  content: [bilingual('Nội dung trang.')],
};

describe('Project — cột xuất bản không ghi được qua API nội dung chung', () => {
  it.each([
    ['CreateProjectDto (POST /projects)', CreateProjectDto],
    ['UpdateProjectDto (PATCH /projects/:slug)', UpdateProjectDto],
  ])('%s từ chối payload có contentStatus', async (_label, metatype) => {
    await expect(
      pipe.transform(
        { ...validProject, contentStatus: 'PUBLISHED' },
        { type: 'body', metatype },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  /** Hình dạng request khai thác: EDITOR gửi MỖI trạng thái, không kèm nội dung. */
  it('payload chỉ mỗi contentStatus qua PATCH bị chặn 400', async () => {
    await expect(
      pipe.transform(
        { contentStatus: 'PUBLISHED' },
        { type: 'body', metatype: UpdateProjectDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  /**
   * Không vơ đũa cả nắm: `status` của Project là TÌNH TRẠNG THI CÔNG, nội dung
   * biên tập bình thường. Nhầm hai field là vừa mở lại lỗ hổng vừa chặn mất việc
   * chính đáng.
   */
  it('`status` (tình trạng thi công) vẫn ghi được — không nhầm với contentStatus', async () => {
    await expect(
      pipe.transform(
        { status: ProjectStatus.DA_BAN_GIAO },
        { type: 'body', metatype: UpdateProjectDto },
      ),
    ).resolves.toMatchObject({ status: ProjectStatus.DA_BAN_GIAO });
  });

  it('sửa nội dung thông thường không bị chặn oan', async () => {
    await expect(
      pipe.transform(
        { title: bilingual('Tên mới'), image: '/images/a.jpg' },
        { type: 'body', metatype: UpdateProjectDto },
      ),
    ).resolves.toMatchObject({ title: { vi: 'Tên mới' } });
  });

  /**
   * **Batch 9.** Dự án nay có `scheduled_at` và `published_at`. Cùng một lý do
   * đã vá ở tin tức: `POST /projects` và `PATCH /projects/:slug` mở cho EDITOR,
   * nên nếu DTO nhận `scheduledAt` thì EDITOR chỉ cần gửi một mốc ở quá khứ là
   * reconciler đăng bài giúp — leo thang quyền, bỏ qua trọn vẹn luồng duyệt.
   * Lịch đăng phải đi qua đúng một cửa: `PATCH /projects/:slug/schedule`
   * (`@Roles(ADMIN, SUPER_ADMIN)`).
   */
  it.each([
    ['scheduledAt', { scheduledAt: '2026-08-20T08:00:00+07:00' }],
    ['publishedAt', { publishedAt: '2026-08-20T08:00:00+07:00' }],
  ])('%s bị từ chối ở cả create lẫn update', async (_label, extra) => {
    for (const metatype of [CreateProjectDto, UpdateProjectDto]) {
      await expect(
        pipe.transform(
          { ...validProject, ...extra },
          { type: 'body', metatype },
        ),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it('payload khai thác thật (chỉ mỗi scheduledAt qua PATCH) bị chặn 400', async () => {
    await expect(
      pipe.transform(
        { scheduledAt: '2020-01-01T00:00:00+07:00' },
        { type: 'body', metatype: UpdateProjectDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('thông báo lỗi chỉ đích danh `scheduledAt`', async () => {
    expect.assertions(1);
    try {
      await pipe.transform(
        { ...validProject, scheduledAt: '2026-08-20T08:00:00+07:00' },
        { type: 'body', metatype: CreateProjectDto },
      );
    } catch (error) {
      const response = (
        error as { getResponse(): { message: string[] } }
      ).getResponse();
      expect(response.message.join(' ')).toContain('scheduledAt');
    }
  });

  /**
   * Chốt này KHÔNG được vơ đũa cả nắm: `eventDate`-kiểu field ngày của nội dung
   * vẫn phải ghi được. Ở dự án, thứ tương đương là `status` (tình trạng thi
   * công) — đã có test riêng ở trên — và các field nội dung thường.
   */
  it('field `scheduledAt` không tồn tại trên DTO (không phải chỉ bị bỏ qua)', () => {
    const instance = plainToInstance(CreateProjectDto, {
      ...validProject,
      scheduledAt: '2026-08-20T08:00:00+07:00',
    });

    const errors = validateSync(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((error) => error.property === 'scheduledAt')).toBe(true);
  });
});

describe('Page — status (xuất bản) không ghi được qua API nội dung chung', () => {
  it.each([
    ['CreatePageDto (POST /pages)', CreatePageDto],
    ['UpdatePageDto (PATCH /pages/:slug)', UpdatePageDto],
  ])('%s từ chối payload có status', async (_label, metatype) => {
    await expect(
      pipe.transform(
        { ...validPage, status: 'PUBLISHED' },
        { type: 'body', metatype },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('payload chỉ mỗi status qua PATCH bị chặn 400', async () => {
    await expect(
      pipe.transform(
        { status: 'PUBLISHED' },
        { type: 'body', metatype: UpdatePageDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('sửa nội dung trang bình thường không bị chặn oan', async () => {
    await expect(
      pipe.transform(
        { title: bilingual('Tiêu đề mới') },
        { type: 'body', metatype: UpdatePageDto },
      ),
    ).resolves.toMatchObject({ title: { vi: 'Tiêu đề mới' } });
  });
});
