import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NewsService } from './news.service';
import { CreateNewsPostDto } from './dto/create-news-post.dto';

/**
 * ADMIN-SUPER-ADMIN-GLOBAL-APPROVAL-BYPASS-M1: khi SUPER_ADMIN tạo bài, bài
 * được đăng ngay (PUBLISHED + publishedAt), không phải đi qua luồng duyệt. Vai
 * trò thấp hơn vẫn tạo bài ở trạng thái nháp (DRAFT) như cũ.
 */
const dto: CreateNewsPostDto = {
  slug: 'bai-viet-moi',
  title: { vi: 'Tiêu đề', en: 'Title' },
  summary: { vi: 'Tóm tắt bài viết', en: 'Summary' },
  content: [{ vi: 'Đoạn 1', en: 'Paragraph 1' }],
};

describe('NewsService.create (bypass duyệt cho SUPER_ADMIN)', () => {
  let service: NewsService;
  let prisma: { newsPost: { create: jest.Mock } };

  beforeEach(async () => {
    prisma = { newsPost: { create: jest.fn() } };

    const moduleRef = await Test.createTestingModule({
      providers: [NewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(NewsService);
    prisma.newsPost.create.mockResolvedValue({ id: 'n1' });
  });

  it('SUPER_ADMIN → PUBLISHED kèm publishedAt', async () => {
    await service.create(dto, Role.SUPER_ADMIN);

    const [{ data }] = prisma.newsPost.create.mock.calls[0] as [
      { data: { status: ContentStatus; publishedAt?: Date } },
    ];
    expect(data.status).toBe(ContentStatus.PUBLISHED);
    expect(data.publishedAt).toBeInstanceOf(Date);
  });

  it('EDITOR → DRAFT, không set publishedAt (giữ luồng duyệt)', async () => {
    await service.create(dto, Role.EDITOR);

    const [{ data }] = prisma.newsPost.create.mock.calls[0] as [
      { data: { status: ContentStatus; publishedAt?: Date } },
    ];
    expect(data.status).toBe(ContentStatus.DRAFT);
    expect(data.publishedAt).toBeUndefined();
  });

  it('ADMIN → DRAFT (chỉ SUPER_ADMIN mới bỏ qua)', async () => {
    await service.create(dto, Role.ADMIN);

    const [{ data }] = prisma.newsPost.create.mock.calls[0] as [
      { data: { status: ContentStatus; publishedAt?: Date } },
    ];
    expect(data.status).toBe(ContentStatus.DRAFT);
  });

  it('không có role → DRAFT (mặc định an toàn)', async () => {
    await service.create(dto);

    const [{ data }] = prisma.newsPost.create.mock.calls[0] as [
      { data: { status: ContentStatus; publishedAt?: Date } },
    ];
    expect(data.status).toBe(ContentStatus.DRAFT);
  });
});

/**
 * ADMIN-CONTENT-STATUS-WORKFLOW-CONSISTENCY-M1: `updateStatus` áp thẳng trạng
 * thái đích cho ADMIN/SUPER_ADMIN (SUPER_ADMIN đăng thẳng DRAFT → PUBLISHED), và
 * chốt mịn quyền theo vai trò qua `assertContentStatusTransition`: EDITOR chỉ được
 * gửi duyệt (DRAFT → PENDING), không đăng thẳng.
 */
describe('NewsService.updateStatus (đổi trạng thái + chốt quyền vai trò)', () => {
  let service: NewsService;
  let prisma: {
    newsPost: { findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      newsPost: { findUnique: jest.fn(), update: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [NewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(NewsService);
    prisma.newsPost.update.mockImplementation(
      (args: { data: Record<string, unknown> }) => ({ id: 'n1', ...args.data }),
    );
  });

  it('SUPER_ADMIN: DRAFT → PUBLISHED trực tiếp, set publishedAt lần đầu', async () => {
    prisma.newsPost.findUnique.mockResolvedValue({
      id: 'n1',
      slug: 'bai-viet-moi',
      status: ContentStatus.DRAFT,
      publishedAt: null,
    });

    await service.updateStatus(
      'bai-viet-moi',
      ContentStatus.PUBLISHED,
      Role.SUPER_ADMIN,
    );

    const [{ data }] = prisma.newsPost.update.mock.calls[0] as [
      { data: { status: ContentStatus; publishedAt?: Date | null } },
    ];
    expect(data.status).toBe(ContentStatus.PUBLISHED);
    expect(data.publishedAt).toBeInstanceOf(Date);
  });

  it('ADMIN: PENDING → PUBLISHED (duyệt & đăng)', async () => {
    prisma.newsPost.findUnique.mockResolvedValue({
      id: 'n1',
      slug: 'bai-viet-moi',
      status: ContentStatus.PENDING,
      publishedAt: null,
    });

    await service.updateStatus(
      'bai-viet-moi',
      ContentStatus.PUBLISHED,
      Role.ADMIN,
    );

    const [{ data }] = prisma.newsPost.update.mock.calls[0] as [
      { data: { status: ContentStatus } },
    ];
    expect(data.status).toBe(ContentStatus.PUBLISHED);
  });

  it('ADMIN: PUBLISHED → DRAFT (trả về nháp), giữ publishedAt cũ', async () => {
    const firstPublishedAt = new Date('2026-07-01T00:00:00Z');
    prisma.newsPost.findUnique.mockResolvedValue({
      id: 'n1',
      slug: 'bai-viet-moi',
      status: ContentStatus.PUBLISHED,
      publishedAt: firstPublishedAt,
    });

    await service.updateStatus('bai-viet-moi', ContentStatus.DRAFT, Role.ADMIN);

    const [{ data }] = prisma.newsPost.update.mock.calls[0] as [
      { data: { status: ContentStatus; publishedAt?: Date | null } },
    ];
    expect(data.status).toBe(ContentStatus.DRAFT);
    expect(data.publishedAt).toBe(firstPublishedAt);
  });

  it('EDITOR: DRAFT → PENDING (gửi duyệt) được phép', async () => {
    prisma.newsPost.findUnique.mockResolvedValue({
      id: 'n1',
      slug: 'bai-viet-moi',
      status: ContentStatus.DRAFT,
      publishedAt: null,
    });

    await service.updateStatus(
      'bai-viet-moi',
      ContentStatus.PENDING,
      Role.EDITOR,
    );

    const [{ data }] = prisma.newsPost.update.mock.calls[0] as [
      { data: { status: ContentStatus } },
    ];
    expect(data.status).toBe(ContentStatus.PENDING);
  });

  it('EDITOR: DRAFT → PUBLISHED bị chặn (403), không ghi DB', async () => {
    prisma.newsPost.findUnique.mockResolvedValue({
      id: 'n1',
      slug: 'bai-viet-moi',
      status: ContentStatus.DRAFT,
      publishedAt: null,
    });

    await expect(
      service.updateStatus(
        'bai-viet-moi',
        ContentStatus.PUBLISHED,
        Role.EDITOR,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.newsPost.update).not.toHaveBeenCalled();
  });

  it('EDITOR: PENDING → PUBLISHED bị chặn (403)', async () => {
    prisma.newsPost.findUnique.mockResolvedValue({
      id: 'n1',
      slug: 'bai-viet-moi',
      status: ContentStatus.PENDING,
      publishedAt: null,
    });

    await expect(
      service.updateStatus(
        'bai-viet-moi',
        ContentStatus.PUBLISHED,
        Role.EDITOR,
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
