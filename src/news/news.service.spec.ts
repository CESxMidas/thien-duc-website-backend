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
