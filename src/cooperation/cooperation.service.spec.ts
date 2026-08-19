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

  describe('create — mọi vai trò đều ra bản nháp', () => {
    /**
     * `create()` không còn nhận `actorRole`: trạng thái khởi tạo là hằng số,
     * không phụ thuộc ai bấm nút. Trước batch chuẩn hoá, SUPER_ADMIN tạo là dự
     * án hiện ngay ở trang chủ.
     */
    it.each([Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN])(
      '%s tạo → contentStatus DRAFT',
      async () => {
        await service.create(dto);

        expect(dataOf(prisma.cooperationProject.create).contentStatus).toBe(
          ContentStatus.DRAFT,
        );
      },
    );

    it('trạng thái mô tả bằng chữ (`status`) vẫn do người dùng đặt', async () => {
      await service.create(dto);

      expect(dataOf(prisma.cooperationProject.create).status).toMatchObject({
        vi: 'Đang triển khai',
      });
    });

    it('payload KHÔNG chèn được contentStatus (server ghi đè sau `...dto`)', async () => {
      await service.create({
        ...dto,
        contentStatus: ContentStatus.PUBLISHED,
      } as never);

      expect(dataOf(prisma.cooperationProject.create).contentStatus).toBe(
        ContentStatus.DRAFT,
      );
    });
  });

  describe('update — sửa nội dung KHÔNG chạm trạng thái xuất bản', () => {
    it('sửa nội dung bình thường vẫn ghi đủ field', async () => {
      await service.update(
        'c1',
        { name: bilingual('Tên mới'), order: 3 },
        Role.EDITOR,
      );

      const data = dataOf(prisma.cooperationProject.update);
      expect(data.name).toMatchObject({ vi: 'Tên mới' });
      expect(data.order).toBe(3);
    });

    it('KHÔNG bao giờ gửi giá trị contentStatus xuống Prisma', async () => {
      await service.update('c1', { name: bilingual('Tên mới') }, Role.EDITOR);

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
      await service.update(
        'c1',
        {
          name: bilingual('Tên mới'),
          contentStatus: ContentStatus.PUBLISHED,
        } as never,
        Role.EDITOR,
      );

      const data = dataOf(prisma.cooperationProject.update);
      expect(data.contentStatus).not.toBe(ContentStatus.PUBLISHED);
    });
  });

  /**
   * Batch 8 — EDITOR không sửa được dự án hợp tác ĐANG hiển thị công khai.
   *
   * Chốt này ĐỘC LẬP với chốt Batch 6 ở trên: Batch 6 ngăn `update` *ghi trạng
   * thái*, batch này ngăn `update` *chạy được* khi nội dung đã qua ranh giới xuất
   * bản. Cả hai cùng nằm trên một route nên phải cùng xanh.
   */
  describe('update — quyền sửa nội dung theo vai trò × trạng thái', () => {
    function given(contentStatus: ContentStatus) {
      prisma.cooperationProject.findUnique.mockResolvedValue({
        id: 'c1',
        contentStatus,
      });
    }

    it.each([ContentStatus.DRAFT, ContentStatus.PENDING])(
      'EDITOR sửa được dự án hợp tác %s',
      async (contentStatus) => {
        given(contentStatus);

        await service.update('c1', { name: bilingual('Tên mới') }, Role.EDITOR);

        expect(dataOf(prisma.cooperationProject.update).name).toMatchObject({
          vi: 'Tên mới',
        });
      },
    );

    it('EDITOR KHÔNG sửa được dự án đã xuất bản → 403, không ghi gì', async () => {
      given(ContentStatus.PUBLISHED);

      await expect(
        service.update('c1', { name: bilingual('Tên mới') }, Role.EDITOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.cooperationProject.update).not.toHaveBeenCalled();
    });

    /**
     * Trạng thái mô tả bằng CHỮ (`status`) vẫn sửa bình thường ở các trạng thái
     * được phép — nó không phải trạng thái xuất bản, và batch này không được
     * chặn lây sang nó.
     */
    it('EDITOR vẫn sửa được `status` (chữ) của dự án chờ duyệt', async () => {
      given(ContentStatus.PENDING);

      await service.update(
        'c1',
        { status: bilingual('Đã hoàn thành') },
        Role.EDITOR,
      );

      expect(dataOf(prisma.cooperationProject.update).status).toMatchObject({
        vi: 'Đã hoàn thành',
      });
    });

    it.each([Role.ADMIN, Role.SUPER_ADMIN])(
      '%s vẫn sửa được dự án đã xuất bản (luồng đính chính)',
      async (role) => {
        given(ContentStatus.PUBLISHED);

        await service.update('c1', { name: bilingual('Tên mới') }, role);

        expect(prisma.cooperationProject.update).toHaveBeenCalledTimes(1);
      },
    );

    it('thiếu vai trò → 403 (fail closed)', async () => {
      given(ContentStatus.DRAFT);

      await expect(
        service.update('c1', { name: bilingual('Tên mới') }),
      ).rejects.toBeInstanceOf(ForbiddenException);
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
