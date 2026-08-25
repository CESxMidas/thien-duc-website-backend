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
          // Batch 11: bản ghi thật luôn mang hai cột mốc. Stub thiếu chúng thì
          // vị từ quyền sửa đọc `undefined !== null` và chặn nhầm.
          scheduledAt: null,
          publishedAt: null,
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

  /**
   * Batch 8 — EDITOR không sửa được trang ĐANG hiển thị công khai.
   *
   * Ba ca dưới đây cố định phần **cơ bản** của luật: trang chưa từng công khai
   * và chưa hẹn giờ thì EDITOR còn sửa được (`DRAFT`, `PENDING`), trang đang
   * đăng thì không. Các ca phụ thuộc lịch/lịch sử xuất bản — đã hẹn giờ, lịch
   * đã tới hạn, nháp TỪNG đăng — nằm ở `pages-editor-edit.service.spec.ts`.
   */
  describe('update — quyền sửa nội dung theo vai trò × trạng thái', () => {
    function given(status: ContentStatus) {
      prisma.page.findUnique.mockResolvedValue({
        id: 'g1',
        slug: 'gioi-thieu',
        status,
        // Chưa từng công khai, chưa hẹn giờ — ca cơ bản của Batch 8. Các ca có
        // lịch/lịch sử nằm ở `pages-editor-edit.service.spec.ts`.
        scheduledAt: null,
        publishedAt: null,
      });
    }

    it.each([ContentStatus.DRAFT, ContentStatus.PENDING])(
      'EDITOR sửa được trang %s',
      async (status) => {
        given(status);

        await service.update(
          'gioi-thieu',
          { title: { vi: 'Tiêu đề mới' } },
          Role.EDITOR,
        );

        expect(dataOf(prisma.page.update).title).toMatchObject({
          vi: 'Tiêu đề mới',
        });
      },
    );

    it('EDITOR KHÔNG sửa được trang đã xuất bản → 403, không ghi gì', async () => {
      given(ContentStatus.PUBLISHED);

      await expect(
        service.update(
          'gioi-thieu',
          { title: { vi: 'Tiêu đề mới' } },
          Role.EDITOR,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.page.update).not.toHaveBeenCalled();
    });

    it.each([Role.ADMIN, Role.SUPER_ADMIN])(
      '%s vẫn sửa được trang đã xuất bản (luồng đính chính)',
      async (role) => {
        given(ContentStatus.PUBLISHED);

        await service.update(
          'gioi-thieu',
          { title: { vi: 'Tiêu đề mới' } },
          role,
        );

        expect(prisma.page.update).toHaveBeenCalledTimes(1);
      },
    );

    it('thiếu vai trò → 403 (fail closed)', async () => {
      given(ContentStatus.DRAFT);

      await expect(
        service.update('gioi-thieu', { title: { vi: 'Tiêu đề mới' } }),
      ).rejects.toBeInstanceOf(ForbiddenException);
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
          scheduledAt: null,
          publishedAt: null,
        });

        await service.updateStatus('gioi-thieu', ContentStatus.PUBLISHED, role);

        expect(dataOf(prisma.page.update).status).toBe(ContentStatus.PUBLISHED);
      },
    );
  });

  describe('hiển thị công khai', () => {
    /**
     * Batch 11 đổi vị từ từ `status = PUBLISHED` sang luật hai nhánh dùng chung.
     * Test khoá đúng HÌNH DẠNG đó: nhánh lịch **phải** kèm `PENDING`, vì thiếu
     * nó thì hàng dị dạng `DRAFT` + lịch quá khứ lọt ra website.
     */
    it('route công khai dùng vị từ hiển thị hai nhánh (đã đăng HOẶC lịch đã tới hạn)', async () => {
      await service.findAll(true);

      const [{ where }] = prisma.page.findMany.mock.calls[0] as [
        {
          where?: {
            OR?: {
              status?: ContentStatus;
              scheduledAt?: { not: null; lte: Date };
            }[];
          };
        },
      ];
      const branches = where?.OR ?? [];
      expect(branches).toHaveLength(2);
      expect(branches[0]).toEqual({ status: ContentStatus.PUBLISHED });
      expect(branches[1]?.status).toBe(ContentStatus.PENDING);
      expect(branches[1]?.scheduledAt?.lte).toBeInstanceOf(Date);
      expect(branches[1]?.scheduledAt?.not).toBeNull();
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
