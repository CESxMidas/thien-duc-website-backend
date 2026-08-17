import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import {
  ContentStatus,
  ProjectStatus,
  Role,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';

/**
 * Vòng đời xuất bản của dự án.
 *
 * Trước batch chuẩn hoá, SUPER_ADMIN tạo dự án là dự án ra công khai ngay
 * (`initialContentStatus`). Nay **mọi vai trò** tạo ra bản nháp, và việc công
 * khai đi qua đúng một cửa `PATCH /projects/:slug/status`.
 *
 * Quyền hạn KHÔNG bị siết: ADMIN và SUPER_ADMIN vẫn đăng thẳng được ngay sau
 * khi tạo — chỉ là phải nói ra ý định đó.
 */
const dto: CreateProjectDto = {
  slug: 'du-an-moi',
  title: { vi: 'Dự án', en: 'Project' },
  summary: { vi: 'Tóm tắt dự án', en: 'Summary' },
  // `status` là TÌNH TRẠNG THI CÔNG — không liên quan bậc thang duyệt.
  status: ProjectStatus.DANG_THI_CONG,
};

describe('ProjectsService — vòng đời xuất bản', () => {
  let service: ProjectsService;
  let prisma: {
    project: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      project: {
        create: jest.fn().mockResolvedValue({ id: 'p1' }),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'p1',
          slug: 'du-an-moi',
          contentStatus: ContentStatus.DRAFT,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(ProjectsService);
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
     * không phụ thuộc ai bấm nút. Vòng lặp theo vai trò giữ ở đây để nói rõ ý
     * định — cả ba vai trò phải cho cùng một kết quả.
     */
    it.each([Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN])(
      '%s tạo dự án → contentStatus DRAFT',
      async () => {
        await service.create(dto);

        expect(dataOf(prisma.project.create).contentStatus).toBe(
          ContentStatus.DRAFT,
        );
      },
    );

    it('tình trạng thi công (`status`) vẫn do người dùng đặt', async () => {
      await service.create(dto);

      expect(dataOf(prisma.project.create).status).toBe(
        ProjectStatus.DANG_THI_CONG,
      );
    });

    it('payload KHÔNG chèn được contentStatus (server ghi đè sau `...dto`)', async () => {
      await service.create({
        ...dto,
        contentStatus: ContentStatus.PUBLISHED,
      } as never);

      expect(dataOf(prisma.project.create).contentStatus).toBe(
        ContentStatus.DRAFT,
      );
    });
  });

  describe('updateStatus — cửa duy nhất để công khai', () => {
    it('EDITOR gửi duyệt: DRAFT → PENDING', async () => {
      await service.updateStatus(
        'du-an-moi',
        ContentStatus.PENDING,
        Role.EDITOR,
      );

      expect(dataOf(prisma.project.update).contentStatus).toBe(
        ContentStatus.PENDING,
      );
    });

    it('EDITOR KHÔNG đăng thẳng được → 403, không ghi gì', async () => {
      await expect(
        service.updateStatus('du-an-moi', ContentStatus.PUBLISHED, Role.EDITOR),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it.each([Role.ADMIN, Role.SUPER_ADMIN])(
      '%s đăng thẳng bản nháp vừa tạo: DRAFT → PUBLISHED',
      async (role) => {
        await service.updateStatus('du-an-moi', ContentStatus.PUBLISHED, role);

        expect(dataOf(prisma.project.update).contentStatus).toBe(
          ContentStatus.PUBLISHED,
        );
      },
    );

    it.each([Role.ADMIN, Role.SUPER_ADMIN])(
      '%s duyệt bài chờ: PENDING → PUBLISHED',
      async (role) => {
        prisma.project.findUnique.mockResolvedValue({
          id: 'p1',
          slug: 'du-an-moi',
          contentStatus: ContentStatus.PENDING,
        });

        await service.updateStatus('du-an-moi', ContentStatus.PUBLISHED, role);

        expect(dataOf(prisma.project.update).contentStatus).toBe(
          ContentStatus.PUBLISHED,
        );
      },
    );
  });

  describe('hiển thị công khai', () => {
    /**
     * Điểm mấu chốt của batch này: dự án SUPER_ADMIN vừa tạo phải RIÊNG TƯ.
     * Route công khai lọc `contentStatus = PUBLISHED`, nên một bản ghi DRAFT
     * không thể lọt ra ngoài.
     */
    it('route công khai chỉ lấy dự án PUBLISHED', async () => {
      await service.findAll(true);

      const [{ where }] = prisma.project.findMany.mock.calls[0] as [
        { where?: { contentStatus?: ContentStatus } },
      ];
      expect(where?.contentStatus).toBe(ContentStatus.PUBLISHED);
    });

    it('dự án vừa tạo (DRAFT) không xem được qua route công khai', async () => {
      await expect(service.findBySlug('du-an-moi', true)).rejects.toThrow();
    });

    it('route Admin vẫn thấy bản nháp', async () => {
      await expect(
        service.findBySlug('du-an-moi', false),
      ).resolves.toMatchObject({ contentStatus: ContentStatus.DRAFT });
    });
  });
});
