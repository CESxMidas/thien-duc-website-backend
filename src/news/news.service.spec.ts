import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NewsService } from './news.service';
import { CreateNewsPostDto } from './dto/create-news-post.dto';

/**
 * NEWS-CREATE-ALWAYS-DRAFT-M1: **tạo nội dung không còn ngầm nghĩa là đăng.**
 *
 * Trước đây SUPER_ADMIN tạo bài là bài công khai ngay (`PUBLISHED` +
 * `publishedAt`). Điều đó khoá luôn khả năng hẹn giờ của chính họ: lệnh đặt lịch
 * chỉ nhận nội dung CHƯA từng công khai, mà bài vừa tạo đã công khai mất rồi —
 * và gỡ về nháp cũng không gỡ được `publishedAt` (mốc đó khi ấy là lịch sử
 * thật). Nay mọi vai trò tạo ra cùng một trạng thái xuất phát: nháp sạch.
 *
 * Quyền hạn KHÔNG bị siết: các test `updateStatus` bên dưới vẫn khoá việc
 * SUPER_ADMIN đăng thẳng `DRAFT → PUBLISHED`. Thứ đổi là **mặc định**, không
 * phải **thẩm quyền**.
 */
const dto: CreateNewsPostDto = {
  slug: 'bai-viet-moi',
  title: { vi: 'Tiêu đề', en: 'Title' },
  summary: { vi: 'Tóm tắt bài viết', en: 'Summary' },
  content: [{ vi: 'Đoạn 1', en: 'Paragraph 1' }],
};

describe('NewsService.create (mọi vai trò → nháp sạch)', () => {
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

  function createdData() {
    const [{ data }] = prisma.newsPost.create.mock.calls[0] as [
      {
        data: {
          status: ContentStatus;
          publishedAt?: Date | null;
          scheduledAt?: Date | null;
        };
      },
    ];
    return data;
  }

  // Ba ca dưới đây gọi `create` y hệt nhau — và đó CHÍNH LÀ điều được khoá:
  // `create` không còn nhận vai trò, nên trạng thái xuất phát không thể phụ
  // thuộc vào ai bấm nút. Chữ ký một tham số khoá việc đó ở tầng kiểu.
  it('EDITOR tạo bài → DRAFT, không mốc công khai, không lịch', async () => {
    await service.create(dto);

    const data = createdData();
    expect(data.status).toBe(ContentStatus.DRAFT);
    expect(data.publishedAt ?? null).toBeNull();
    expect(data.scheduledAt ?? null).toBeNull();
  });

  it('ADMIN tạo bài → DRAFT, không mốc công khai, không lịch', async () => {
    await service.create(dto);

    const data = createdData();
    expect(data.status).toBe(ContentStatus.DRAFT);
    expect(data.publishedAt ?? null).toBeNull();
  });

  /** Chính là ca hỏng trước đây — bài của SUPER_ADMIN không được tự công khai. */
  it('SUPER_ADMIN tạo bài → DRAFT, KHÔNG tự đăng', async () => {
    await service.create(dto);

    const data = createdData();
    expect(data.status).toBe(ContentStatus.DRAFT);
    expect(data.publishedAt ?? null).toBeNull();
    expect(data.scheduledAt ?? null).toBeNull();
  });

  /**
   * Trạng thái do server đặt. DTO nội dung không khai báo `status` lẫn
   * `scheduledAt`, và `forbidNonWhitelisted` chặn payload lạ ở tầng
   * ValidationPipe — nên dù client có nhét vào cũng không tới được câu ghi DB.
   */
  it('không nhận status / scheduledAt từ payload', async () => {
    await service.create({
      ...dto,
      status: ContentStatus.PUBLISHED,
      scheduledAt: '2026-08-20T08:00:00+07:00',
    } as CreateNewsPostDto);

    const data = createdData();
    expect(data.status).toBe(ContentStatus.DRAFT);
    expect(data.scheduledAt ?? null).toBeNull();
  });
});

/**
 * Hai chuỗi lệnh mà Admin CMS thực sự chạy sau khi tạo bài. Chúng là lý do tồn
 * tại của thay đổi trên: trước đây chuỗi thứ hai KHÔNG chạy được với
 * SUPER_ADMIN.
 */
describe('NewsService — tạo rồi ra lệnh xuất bản (SUPER_ADMIN)', () => {
  let service: NewsService;
  let prisma: {
    newsPost: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      newsPost: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [NewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(NewsService);
    prisma.newsPost.update.mockImplementation(
      (args: { data: Record<string, unknown> }) => ({ id: 'n1', ...args.data }),
    );
  });

  /** Bài vừa được `create` trả về, đọc lại đúng như DB sẽ trả. */
  function justCreated() {
    return {
      id: 'n1',
      slug: 'bai-viet-moi',
      status: ContentStatus.DRAFT,
      publishedAt: null,
      scheduledAt: null,
    };
  }

  it('tạo → "Đăng ngay": PUBLISHED, publishedAt là lúc bấm, không còn lịch', async () => {
    prisma.newsPost.create.mockResolvedValue(justCreated());
    prisma.newsPost.findUnique.mockResolvedValue(justCreated());
    const created = await service.create(dto);
    const before = Date.now();

    await service.updateStatus(
      created.slug,
      ContentStatus.PUBLISHED,
      Role.SUPER_ADMIN,
    );

    const [{ data }] = prisma.newsPost.update.mock.calls[0] as [
      {
        data: {
          status: ContentStatus;
          publishedAt?: Date | null;
          scheduledAt?: Date | null;
        };
      },
    ];
    expect(data.status).toBe(ContentStatus.PUBLISHED);
    expect(data.publishedAt).toBeInstanceOf(Date);
    expect((data.publishedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(data.scheduledAt).toBeNull();
  });

  it('tạo → "Đặt lịch": PENDING với scheduledAt = publishedAt = mốc đã hẹn', async () => {
    prisma.newsPost.create.mockResolvedValue(justCreated());
    prisma.newsPost.findUnique.mockResolvedValue(justCreated());
    const created = await service.create(dto);
    const scheduledAtIso = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await service.schedulePublication(created.slug, scheduledAtIso);

    const [{ data }] = prisma.newsPost.update.mock.calls[0] as [
      { data: { status: ContentStatus; scheduledAt: Date; publishedAt: Date } },
    ];
    expect(data.status).toBe(ContentStatus.PENDING);
    expect(data.scheduledAt.toISOString()).toBe(scheduledAtIso);
    // Bất biến D: mốc công khai được ghi sẵn bằng đúng mốc hẹn.
    expect(data.publishedAt.toISOString()).toBe(scheduledAtIso);
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
