import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ContentStatus, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PagesService } from './pages.service';
import { CreatePageDto } from './dto/create-page.dto';

/**
 * Vòng đời xuất bản của trang nội dung.
 *
 * Trước batch chuẩn hoá, SUPER_ADMIN tạo trang là trang lên website ngay. Với
 * trang tĩnh thì điều đó còn khó chịu hơn tin tức: một trang thường được dựng
 * dần qua nhiều lần lưu, mà lần lưu đầu tiên đã là URL công khai dở dang.
 *
 * Nay mọi vai trò tạo ra bản nháp, và việc công khai đi qua đúng một cửa
 * `PATCH /pages/:slug/status`. Quyền hạn không đổi.
 */
const dto: CreatePageDto = {
  slug: 'gioi-thieu',
  title: { vi: 'Giới thiệu', en: 'About' },
  content: [{ vi: 'Nội dung trang giới thiệu.', en: 'About content.' }],
};

describe('PagesService — vòng đời xuất bản', () => {
  let service: PagesService;
  let prisma: {
    page: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      page: {
        create: jest.fn().mockResolvedValue({ id: 'g1' }),
        update: jest.fn().mockResolvedValue({ id: 'g1' }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'g1',
          slug: 'gioi-thieu',
          status: ContentStatus.DRAFT,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [PagesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(PagesService);
  });

  /** `data` của lời gọi Prisma gần nhất. */
  function dataOf(mock: jest.Mock): Record<string, unknown> {
    const [{ data }] = mock.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    return data;
  }

  describe('create — mọi vai trò đều ra bản nháp', () => {
    it.each([Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN])(
      '%s tạo trang → status DRAFT',
      async () => {
        await service.create(dto);

        expect(dataOf(prisma.page.create).status).toBe(ContentStatus.DRAFT);
      },
    );

    it('payload KHÔNG chèn được status (server ghi đè sau `...dto`)', async () => {
      await service.create({
        ...dto,
        status: ContentStatus.PUBLISHED,
      } as never);

      expect(dataOf(prisma.page.create).status).toBe(ContentStatus.DRAFT);
    });

    it('nội dung trang vẫn ghi bình thường', async () => {
      await service.create(dto);

      const data = dataOf(prisma.page.create);
      expect(data.slug).toBe('gioi-thieu');
      expect(data.title).toMatchObject({ vi: 'Giới thiệu' });
    });
  });

  describe('updateStatus — cửa duy nhất để công khai', () => {
    it('EDITOR gửi duyệt: DRAFT → PENDING', async () => {
      await service.updateStatus(
        'gioi-thieu',
        ContentStatus.PENDING,
        Role.EDITOR,
      );

      expect(dataOf(prisma.page.update).status).toBe(ContentStatus.PENDING);
    });

    it('EDITOR KHÔNG đăng thẳng được → 403, không ghi gì', async () => {
      await expect(
        service.updateStatus(
          'gioi-thieu',
          ContentStatus.PUBLISHED,
          Role.EDITOR,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.page.update).not.toHaveBeenCalled();
    });

    it.each([Role.ADMIN, Role.SUPER_ADMIN])(
      '%s đăng thẳng bản nháp vừa tạo: DRAFT → PUBLISHED',
      async (role) => {
        await service.updateStatus('gioi-thieu', ContentStatus.PUBLISHED, role);

        expect(dataOf(prisma.page.update).status).toBe(ContentStatus.PUBLISHED);
      },
    );

    it.each([Role.ADMIN, Role.SUPER_ADMIN])(
      '%s duyệt trang chờ: PENDING → PUBLISHED',
      async (role) => {
        prisma.page.findUnique.mockResolvedValue({
          id: 'g1',
          slug: 'gioi-thieu',
          status: ContentStatus.PENDING,
        });

        await service.updateStatus('gioi-thieu', ContentStatus.PUBLISHED, role);

        expect(dataOf(prisma.page.update).status).toBe(ContentStatus.PUBLISHED);
      },
    );
  });

  describe('hiển thị công khai', () => {
    it('route công khai chỉ lấy trang PUBLISHED', async () => {
      await service.findAll(true);

      const [{ where }] = prisma.page.findMany.mock.calls[0] as [
        { where?: { status?: ContentStatus } },
      ];
      expect(where?.status).toBe(ContentStatus.PUBLISHED);
    });

    it('trang vừa tạo (DRAFT) không xem được qua route công khai', async () => {
      await expect(service.findBySlug('gioi-thieu', true)).rejects.toThrow();
    });

    it('route Admin vẫn thấy bản nháp', async () => {
      await expect(
        service.findBySlug('gioi-thieu', false),
      ).resolves.toMatchObject({ status: ContentStatus.DRAFT });
    });
  });
});
