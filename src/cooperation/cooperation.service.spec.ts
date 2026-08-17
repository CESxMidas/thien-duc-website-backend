import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ContentStatus, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CooperationService } from './cooperation.service';
import { CreateCooperationProjectDto } from './dto/create-cooperation-project.dto';

/**
 * Dự án hợp tác — trạng thái xuất bản do SERVER sở hữu.
 *
 * Batch này đóng đường ghi `contentStatus` qua API nội dung chung (xem
 * `dto/cooperation-status-write-block.spec.ts` cho chốt ở tầng ValidationPipe).
 * Bộ test này khoá phần còn lại của hợp đồng ở tầng service: ai đặt trạng thái
 * khởi tạo, đường nào đổi được trạng thái, và **sửa nội dung thì tuyệt đối
 * không chạm tới trạng thái**.
 *
 * Hành vi tạo mới của SUPER_ADMIN (xuất bản ngay) được khoá **nguyên trạng** ở
 * đây một cách cố ý: nó là một quyết định nghiệp vụ riêng, không thuộc bản vá
 * bảo mật này. Test đứng đây để nếu batch sau đổi nó thì phải đổi có ý thức.
 */

const bilingual = (vi: string) => ({ vi, en: vi });

const dto: CreateCooperationProjectDto = {
  name: bilingual('Khu đô thị hợp tác'),
  location: bilingual('Bến Tre'),
  role: bilingual('Đồng phát triển'),
  partner: bilingual('Đối tác'),
  scale: bilingual('10 ha'),
  // Trạng thái mô tả bằng CHỮ của dự án — không phải ContentStatus.
  status: bilingual('Đang triển khai'),
};

describe('CooperationService', () => {
  let service: CooperationService;
  let prisma: {
    cooperationProject: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      cooperationProject: {
        create: jest.fn().mockResolvedValue({ id: 'c1' }),
        update: jest.fn().mockResolvedValue({ id: 'c1' }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          contentStatus: ContentStatus.DRAFT,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CooperationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(CooperationService);
  });

  /** `data` của lời gọi Prisma gần nhất. */
  function dataOf(mock: jest.Mock): Record<string, unknown> {
    const [{ data }] = mock.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    return data;
  }

  describe('create — trạng thái khởi tạo do server đặt', () => {
    it.each([
      [Role.EDITOR, ContentStatus.DRAFT],
      [Role.ADMIN, ContentStatus.DRAFT],
      // Hành vi HIỆN TẠI, cố ý giữ nguyên trong bản vá bảo mật này.
      [Role.SUPER_ADMIN, ContentStatus.PUBLISHED],
    ])('%s tạo → contentStatus %s', async (role, expected) => {
      await service.create(dto, role);

      expect(dataOf(prisma.cooperationProject.create).contentStatus).toBe(
        expected,
      );
    });

    it('không có vai trò (gọi nội bộ) → nháp, không tự công khai', async () => {
      await service.create(dto);

      expect(dataOf(prisma.cooperationProject.create).contentStatus).toBe(
        ContentStatus.DRAFT,
      );
    });
  });

  describe('update — sửa nội dung KHÔNG chạm trạng thái xuất bản', () => {
    it('sửa nội dung bình thường vẫn ghi đủ field', async () => {
      await service.update('c1', { name: bilingual('Tên mới'), order: 3 });

      const data = dataOf(prisma.cooperationProject.update);
      expect(data.name).toMatchObject({ vi: 'Tên mới' });
      expect(data.order).toBe(3);
    });

    it('KHÔNG bao giờ gửi giá trị contentStatus xuống Prisma', async () => {
      await service.update('c1', { name: bilingual('Tên mới') });

      // `undefined` là cách Prisma hiểu "giữ nguyên cột" — khác hẳn việc ghi
      // một trạng thái mới. Khoá đúng giá trị này thay vì sự vắng mặt của khoá,
      // vì `update()` cố ý đặt `contentStatus: undefined` làm lớp chốt thứ hai.
      expect(dataOf(prisma.cooperationProject.update).contentStatus).toBe(
        undefined,
      );
    });

    /**
     * Phòng thủ chiều sâu: kể cả khi một payload dị dạng lọt qua được tầng
     * ValidationPipe (vd. có người gọi service trực tiếp), `update()` cũng
     * không được biến nó thành lệnh xuất bản. Ép kiểu ở đây là cố ý — đúng
     * hình dạng mà TypeScript nay đã cấm ở biên API.
     */
    it('payload dị dạng mang contentStatus không đăng được bài', async () => {
      await service.update('c1', {
        name: bilingual('Tên mới'),
        contentStatus: ContentStatus.PUBLISHED,
      } as never);

      const data = dataOf(prisma.cooperationProject.update);
      expect(data.contentStatus).not.toBe(ContentStatus.PUBLISHED);
    });
  });

  describe('updateStatus — cửa DUY NHẤT đổi trạng thái, có kiểm vai trò', () => {
    it('EDITOR gửi duyệt: DRAFT → PENDING', async () => {
      await service.updateStatus('c1', ContentStatus.PENDING, Role.EDITOR);

      expect(dataOf(prisma.cooperationProject.update).contentStatus).toBe(
        ContentStatus.PENDING,
      );
    });

    it('EDITOR KHÔNG đăng thẳng được (DRAFT → PUBLISHED bị 403)', async () => {
      await expect(
        service.updateStatus('c1', ContentStatus.PUBLISHED, Role.EDITOR),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.cooperationProject.update).not.toHaveBeenCalled();
    });

    it.each([Role.ADMIN, Role.SUPER_ADMIN])(
      '%s duyệt & đăng: PENDING → PUBLISHED',
      async (role) => {
        prisma.cooperationProject.findUnique.mockResolvedValue({
          id: 'c1',
          contentStatus: ContentStatus.PENDING,
        });

        await service.updateStatus('c1', ContentStatus.PUBLISHED, role);

        expect(dataOf(prisma.cooperationProject.update).contentStatus).toBe(
          ContentStatus.PUBLISHED,
        );
      },
    );

    it.each([Role.ADMIN, Role.SUPER_ADMIN])(
      '%s gỡ bài: PUBLISHED → DRAFT',
      async (role) => {
        prisma.cooperationProject.findUnique.mockResolvedValue({
          id: 'c1',
          contentStatus: ContentStatus.PUBLISHED,
        });

        await service.updateStatus('c1', ContentStatus.DRAFT, role);

        expect(dataOf(prisma.cooperationProject.update).contentStatus).toBe(
          ContentStatus.DRAFT,
        );
      },
    );
  });

  describe('hiển thị công khai', () => {
    it('route công khai chỉ lấy bài PUBLISHED', async () => {
      await service.findAll(true);

      const [{ where }] = prisma.cooperationProject.findMany.mock.calls[0] as [
        { where?: { contentStatus?: ContentStatus } },
      ];
      expect(where?.contentStatus).toBe(ContentStatus.PUBLISHED);
    });

    it('route Admin thấy mọi trạng thái', async () => {
      await service.findAll(false);

      const [{ where }] = prisma.cooperationProject.findMany.mock.calls[0] as [
        { where?: unknown },
      ];
      expect(where).toBeUndefined();
    });
  });
});
