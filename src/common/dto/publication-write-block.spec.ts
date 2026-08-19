import { ValidationPipe } from '@nestjs/common';
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
 * Lưu ý về **chiều sâu phòng thủ**: `CooperationService.update()` còn ghi
 * `contentStatus: undefined` sau `...dto` làm lớp chốt thứ hai;
 * `ProjectsService.update()` và `PagesService.update()` thì KHÔNG — chúng chỉ có
 * đúng một lớp là ValidationPipe. Batch 8 không đổi điều đó (ngoài phạm vi), nên
 * spec này chính là thứ canh lớp duy nhất ấy.
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

describe('Project — contentStatus không ghi được qua API nội dung chung', () => {
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
