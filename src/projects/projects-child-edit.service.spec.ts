import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from './projects.service';

/**
 * **Batch 8 (mở rộng) — nội dung CON của dự án thừa hưởng luật quản trị của cha.**
 *
 * Đường vòng được đóng ở đây:
 *
 * ```
 * PATCH /projects/:slug                     → EDITOR bị chặn (Batch 8)
 * PATCH /projects/:slug/items/:itemSlug     → EDITOR VẪN sửa được  ← lỗ hổng
 * POST/PATCH/DELETE /projects/:slug/gallery → EDITOR VẪN sửa được  ← lỗ hổng
 * ```
 *
 * `ProjectItem` và `ProjectGalleryImage` không có trạng thái xuất bản riêng: chúng
 * ra công khai *vì* dự án cha ra công khai. Nên chặn cửa trước mà bỏ ngỏ cửa sau
 * thì nội dung đang chạy trên website vẫn đổi được mà không ai duyệt lại — vi
 * phạm đúng bất biến trung tâm của Batch 8.
 *
 * Bộ test này khoá cả ba tính chất: chặn đúng trạng thái, **không ghi gì sau khi
 * bị chặn**, và ADMIN+ không bị siết theo.
 */

const IMAGE_ID = 'img-1';

/** Mọi lệnh ghi con của dự án, gọi qua đúng chữ ký service thật. */
const CHILD_MUTATIONS = [
  {
    name: 'thêm hạng mục',
    run: (service: ProjectsService, role?: string) =>
      service.createItem(
        'du-an',
        { slug: 'hang-muc-moi', title: { vi: 'Hạng mục' } },
        role,
      ),
    mutation: () => 'projectItem.create',
  },
  {
    name: 'sửa hạng mục',
    run: (service: ProjectsService, role?: string) =>
      service.updateItem('du-an', 'hang-muc', { title: { vi: 'Mới' } }, role),
    mutation: () => 'projectItem.update',
  },
  {
    name: 'xóa hạng mục',
    run: (service: ProjectsService, role?: string) =>
      service.removeItem('du-an', 'hang-muc', role),
    mutation: () => 'projectItem.delete',
  },
  {
    name: 'thêm ảnh thư viện',
    run: (service: ProjectsService, role?: string) =>
      service.addGalleryImage('du-an', { url: '/images/a.jpg' }, role),
    mutation: () => 'projectGalleryImage.create',
  },
  {
    name: 'sửa ảnh thư viện',
    run: (service: ProjectsService, role?: string) =>
      service.updateGalleryImage('du-an', IMAGE_ID, { order: 3 }, role),
    mutation: () => 'projectGalleryImage.update',
  },
  {
    name: 'xóa ảnh thư viện',
    run: (service: ProjectsService, role?: string) =>
      service.removeGalleryImage('du-an', IMAGE_ID, role),
    mutation: () => 'projectGalleryImage.delete',
  },
  {
    name: 'sắp xếp lại thư viện',
    run: (service: ProjectsService, role?: string) =>
      service.reorderGallery('du-an', [IMAGE_ID], role),
    mutation: () => 'projectGalleryImage.update',
  },
] as const;

describe('ProjectsService — nội dung con thừa hưởng quyền của dự án cha', () => {
  let service: ProjectsService;
  let prisma: {
    project: { findUnique: jest.Mock };
    projectItem: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    projectGalleryImage: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      project: { findUnique: jest.fn() },
      projectItem: {
        findFirst: jest.fn().mockResolvedValue({ id: 'item-1' }),
        create: jest.fn().mockResolvedValue({ id: 'item-1' }),
        update: jest.fn().mockResolvedValue({ id: 'item-1' }),
        delete: jest.fn().mockResolvedValue({ id: 'item-1' }),
      },
      projectGalleryImage: {
        findFirst: jest.fn().mockResolvedValue({ id: IMAGE_ID, order: 0 }),
        findMany: jest.fn().mockResolvedValue([{ id: IMAGE_ID }]),
        create: jest.fn().mockResolvedValue({ id: IMAGE_ID }),
        update: jest.fn().mockResolvedValue({ id: IMAGE_ID }),
        delete: jest.fn().mockResolvedValue({ id: IMAGE_ID }),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(ProjectsService);
  });

  /** Nạp dự án cha với một `contentStatus` cho trước. */
  function givenParent(contentStatus: ContentStatus) {
    prisma.project.findUnique.mockResolvedValue({
      id: 'p1',
      slug: 'du-an',
      contentStatus,
      items: [],
      galleryImages: [],
    });
  }

  /** Mọi lời gọi Prisma có thể GHI dữ liệu con. */
  function writeCalls(): number {
    return (
      prisma.projectItem.create.mock.calls.length +
      prisma.projectItem.update.mock.calls.length +
      prisma.projectItem.delete.mock.calls.length +
      prisma.projectGalleryImage.create.mock.calls.length +
      prisma.projectGalleryImage.update.mock.calls.length +
      prisma.projectGalleryImage.delete.mock.calls.length +
      prisma.$transaction.mock.calls.length
    );
  }

  describe('cha PUBLISHED — EDITOR bị chặn ở MỌI lệnh con', () => {
    it.each(CHILD_MUTATIONS.map((m) => [m.name, m] as const))(
      '%s → 403',
      async (_name, mutation) => {
        givenParent(ContentStatus.PUBLISHED);

        await expect(mutation.run(service, Role.EDITOR)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      },
    );

    /**
     * Phép kiểm quan trọng nhất của bộ này: chặn phải xảy ra TRƯỚC khi ghi. Nếu
     * thứ tự bị đảo, các test ở trên vẫn xanh (vẫn ném 403) trong khi dữ liệu
     * công khai đã bị đổi.
     */
    it.each(CHILD_MUTATIONS.map((m) => [m.name, m] as const))(
      '%s: KHÔNG có lời gọi ghi nào xuống Prisma',
      async (_name, mutation) => {
        givenParent(ContentStatus.PUBLISHED);

        await expect(mutation.run(service, Role.EDITOR)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(writeCalls()).toBe(0);
      },
    );

    it('thông điệp 403 nói rõ là hạng mục / thư viện ảnh', async () => {
      givenParent(ContentStatus.PUBLISHED);

      await expect(
        service.updateItem('du-an', 'hang-muc', {}, Role.EDITOR),
      ).rejects.toThrow(/hạng mục và thư viện ảnh/);
    });
  });

  describe('cha DRAFT — EDITOR sửa được nội dung con', () => {
    it.each(CHILD_MUTATIONS.map((m) => [m.name, m] as const))(
      '%s → cho phép',
      async (_name, mutation) => {
        givenParent(ContentStatus.DRAFT);

        await expect(mutation.run(service, Role.EDITOR)).resolves.toBeDefined();
        expect(writeCalls()).toBeGreaterThan(0);
      },
    );
  });

  /**
   * §10 — KHÔNG siết PENDING thêm trong lần mở rộng này. Project chưa có
   * `publishedAt`/`scheduledAt`; PENDING vẫn mang nghĩa "đang trong khâu duyệt
   * biên tập", nên nội dung con còn sửa được.
   */
  describe('cha PENDING — EDITOR vẫn sửa được nội dung con', () => {
    it.each(CHILD_MUTATIONS.map((m) => [m.name, m] as const))(
      '%s → cho phép',
      async (_name, mutation) => {
        givenParent(ContentStatus.PENDING);

        await expect(mutation.run(service, Role.EDITOR)).resolves.toBeDefined();
        expect(writeCalls()).toBeGreaterThan(0);
      },
    );
  });

  /** §11 — luồng đính chính của quản trị trên dự án ĐANG chạy không được mất. */
  describe('cha PUBLISHED — ADMIN / SUPER_ADMIN giữ nguyên quyền', () => {
    it.each(
      CHILD_MUTATIONS.flatMap((m) =>
        [Role.ADMIN, Role.SUPER_ADMIN].map(
          (role) => [`${m.name} (${role})`, m, role] as const,
        ),
      ),
    )('%s → cho phép', async (_label, mutation, role) => {
      givenParent(ContentStatus.PUBLISHED);

      await expect(mutation.run(service, role)).resolves.toBeDefined();
      expect(writeCalls()).toBeGreaterThan(0);
    });
  });

  describe('nguồn vai trò', () => {
    it('thiếu vai trò → 403 kể cả khi cha là DRAFT (fail closed)', async () => {
      givenParent(ContentStatus.DRAFT);

      await expect(
        service.updateItem('du-an', 'hang-muc', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(writeCalls()).toBe(0);
    });

    it('biến thể sai chính tả không lấy được quyền ADMIN', async () => {
      givenParent(ContentStatus.PUBLISHED);

      await expect(
        service.updateItem('du-an', 'hang-muc', {}, 'Admin'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  /**
   * §16 — không biến bản ghi không tồn tại thành 403 gây hiểu sai. Tra cứu đi
   * trước, nên "không tìm thấy" vẫn là 404 y như trước.
   */
  describe('404 vẫn là 404', () => {
    it('dự án cha không tồn tại → NotFound (không phải 403)', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(
        service.updateItem('khong-co', 'hang-muc', {}, Role.EDITOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('hạng mục không tồn tại trên dự án PUBLISHED → NotFound', async () => {
      givenParent(ContentStatus.PUBLISHED);
      prisma.projectItem.findFirst.mockResolvedValue(null);

      await expect(
        service.updateItem('du-an', 'khong-co', {}, Role.EDITOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ảnh không thuộc dự án → NotFound', async () => {
      givenParent(ContentStatus.PUBLISHED);
      prisma.projectGalleryImage.findFirst.mockResolvedValue(null);

      await expect(
        service.removeGalleryImage('du-an', 'khong-co', Role.EDITOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  /**
   * Route GET không bị ảnh hưởng: `findItemBySlug` vẫn trả về đúng hạng mục
   * (không phải cặp `{ project, item }`) vì đó là response body của API.
   */
  it('findItemBySlug giữ nguyên hình dạng trả về (chỉ hạng mục)', async () => {
    givenParent(ContentStatus.PUBLISHED);

    await expect(service.findItemBySlug('du-an', 'hang-muc')).resolves.toEqual({
      id: 'item-1',
    });
  });
});
