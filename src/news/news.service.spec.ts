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
 * ADMIN-SUPER-ADMIN-GLOBAL-ADMIN-WORKFLOW-FIX-M1: `updateStatus` áp thẳng trạng
 * thái đích, không ép đi qua PENDING. Nhờ vậy SUPER_ADMIN đăng thẳng bài nháp
 * (DRAFT → PUBLISHED) từ Admin, và bài được gắn publishedAt ở lần đăng đầu.
 * Quyền gọi route đã do `@Roles(ADMIN, SUPER_ADMIN)` chốt ở controller.
 */
describe('NewsService.updateStatus (đổi trạng thái trực tiếp)', () => {
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

  it('DRAFT → PUBLISHED trực tiếp, set publishedAt lần đầu', async () => {
    prisma.newsPost.findUnique.mockResolvedValue({
      id: 'n1',
      slug: 'bai-viet-moi',
      status: ContentStatus.DRAFT,
      publishedAt: null,
    });

    await service.updateStatus('bai-viet-moi', ContentStatus.PUBLISHED);

    const [{ data }] = prisma.newsPost.update.mock.calls[0] as [
      { data: { status: ContentStatus; publishedAt?: Date | null } },
    ];
    expect(data.status).toBe(ContentStatus.PUBLISHED);
    expect(data.publishedAt).toBeInstanceOf(Date);
  });

  it('PUBLISHED → DRAFT (trả về nháp), giữ publishedAt cũ', async () => {
    const firstPublishedAt = new Date('2026-07-01T00:00:00Z');
    prisma.newsPost.findUnique.mockResolvedValue({
      id: 'n1',
      slug: 'bai-viet-moi',
      status: ContentStatus.PUBLISHED,
      publishedAt: firstPublishedAt,
    });

    await service.updateStatus('bai-viet-moi', ContentStatus.DRAFT);

    const [{ data }] = prisma.newsPost.update.mock.calls[0] as [
      { data: { status: ContentStatus; publishedAt?: Date | null } },
    ];
    expect(data.status).toBe(ContentStatus.DRAFT);
    expect(data.publishedAt).toBe(firstPublishedAt);
  });
});
