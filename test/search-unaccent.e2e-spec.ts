/**
 * THIEN-DUC-OPTIONAL-BACKLOG-REPO-WORK-M1 — tìm kiếm BỎ DẤU tiếng Việt (YC-10).
 *
 * Trạng thái trước phiên này: backlog §6 đánh dấu `[x]` NHƯNG mã nguồn KHÔNG hề
 * có `unaccent` — hai hàm `*_search_document` dựng tsvector trên chuỗi nguyên
 * văn. Đã đo được trên DB thật: `"du an"` KHÔNG khớp `"Dự án"`. Checkbox sai,
 * không phải tính năng đã có.
 *
 * Migration `20260731120000_search_unaccent` bọc `immutable_unaccent()` ở CẢ hai
 * phía (tsvector khi dựng tài liệu, tsquery khi dựng truy vấn). Bộ test này
 * chạy qua HTTP thật trên PostgreSQL thật, phủ đúng những gì backlog yêu cầu:
 * có dấu, không dấu, hoa/thường, một phần, chỉ nội dung PUBLISHED, không lộ
 * DRAFT/PENDING, thứ tự tất định, và input kiểu SQL-injection vô hại.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

const E2E_TAG = 'e2eunaccent';

type SearchBody = {
  success: boolean;
  data: {
    query: string;
    projects: Array<{ id: string; slug: string; title: unknown }>;
    news: Array<{ id: string; slug: string }>;
  };
};

describe('Tìm kiếm bỏ dấu (PostgreSQL thật)', () => {
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;

  const slugs = {
    published: `${E2E_TAG}-published`,
    draft: `${E2E_TAG}-draft`,
    other: `${E2E_TAG}-other`,
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'Thiếu DATABASE_URL — integration test cần Postgres thật.',
      );
    }
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    await cleanup();

    // Dự án ĐÃ ĐĂNG — mục tiêu chính của mọi phép tìm.
    await prisma.project.create({
      data: {
        slug: slugs.published,
        title: {
          vi: 'Khu dân cư Thiện Đức Mỹ Phước',
          en: 'Thien Duc Residential',
        },
        summary: { vi: 'Khu dân cư kiểu mẫu tại Bình Dương.' },
        status: 'DANG_THI_CONG',
        contentStatus: 'PUBLISHED',
        location: { vi: 'Bình Dương' },
      },
    });

    // Dự án NHÁP — không bao giờ được lộ qua tìm kiếm công khai.
    await prisma.project.create({
      data: {
        slug: slugs.draft,
        title: { vi: 'Khu dân cư Thiện Đức Bí Mật' },
        summary: { vi: 'Bản nháp chưa duyệt.' },
        status: 'CHUAN_BI_KHOI_CONG',
        contentStatus: 'DRAFT',
        location: { vi: 'Bình Dương' },
      },
    });

    // Dự án đã đăng nhưng KHÔNG liên quan từ khóa — dùng để bắt kết quả thừa.
    await prisma.project.create({
      data: {
        slug: slugs.other,
        title: { vi: 'Cao ốc Vĩnh Lộc' },
        summary: { vi: 'Một dự án hoàn toàn khác.' },
        status: 'DA_BAN_GIAO',
        contentStatus: 'PUBLISHED',
        location: { vi: 'TP.HCM' },
      },
    });
  });

  async function cleanup(): Promise<void> {
    await prisma.project.deleteMany({
      where: { slug: { startsWith: E2E_TAG } },
    });
  }

  afterAll(async () => {
    if (prisma) await cleanup();
    if (app) await app.close();
  });

  /** Gọi API tìm kiếm và trả về danh sách slug dự án khớp. */
  async function searchSlugs(
    q: string,
    expectedStatus = 200,
  ): Promise<string[]> {
    const res = await request(http)
      .get('/api/search')
      .query({ q })
      .expect(expectedStatus);
    const body = res.body as SearchBody;
    return body.data.projects.map((project) => project.slug);
  }

  describe('khớp bất kể dấu và hoa/thường', () => {
    it.each([
      ['đúng nguyên văn có dấu', 'Thiện Đức'],
      ['BỎ DẤU hoàn toàn', 'Thien Duc'],
      ['bỏ dấu + chữ thường', 'thien duc'],
      ['CHỮ HOA có dấu', 'THIỆN ĐỨC'],
      ['CHỮ HOA bỏ dấu', 'THIEN DUC'],
      ['một từ, bỏ dấu', 'thien'],
      ['từ khác trong tiêu đề, bỏ dấu', 'my phuoc'],
      ['từ trong địa điểm, bỏ dấu', 'binh duong'],
    ])('%s → tìm thấy dự án đã đăng', async (_label, q) => {
      expect(await searchSlugs(q)).toContain(slugs.published);
    });

    it('từ khóa tiếng Anh vẫn khớp bản dịch en', async () => {
      expect(await searchSlugs('residential')).toContain(slugs.published);
    });
  });

  describe('không trả kết quả sai', () => {
    it('từ khóa không liên quan → không có dự án nào của fixture', async () => {
      const found = await searchSlugs('khong-he-ton-tai-zzz');
      expect(found).not.toContain(slugs.published);
      expect(found).not.toContain(slugs.other);
    });

    it('không kéo nhầm dự án đã đăng khác vào kết quả', async () => {
      expect(await searchSlugs('thien duc')).not.toContain(slugs.other);
    });
  });

  describe('quyền riêng tư nội dung — chỉ PUBLISHED', () => {
    it.each([
      ['có dấu', 'Thiện Đức'],
      ['bỏ dấu', 'thien duc'],
      ['đúng từ trong tiêu đề bản nháp, bỏ dấu', 'bi mat'],
      ['đúng từ trong tiêu đề bản nháp, có dấu', 'Bí Mật'],
    ])('bản DRAFT KHÔNG lộ qua tìm kiếm (%s)', async (_label, q) => {
      expect(await searchSlugs(q)).not.toContain(slugs.draft);
    });
  });

  describe('an toàn và hợp đồng đầu vào', () => {
    it.each([
      ['nháy đơn + OR 1=1', "' OR 1=1; --"],
      ['DROP TABLE', "'; DROP TABLE users; --"],
      ['toán tử FTS thô', 'thien & duc | (bi <-> mat)'],
      ['ký tự đặc biệt', '%_\\:*!&|'],
    ])(
      'input kiểu injection (%s) được xử lý như văn bản thường, không lỗi 500',
      async (_l, q) => {
        const res = await request(http).get('/api/search').query({ q });
        expect([200, 400]).toContain(res.status);
        expect(res.status).not.toBe(500);
      },
    );

    it('bảng users vẫn còn nguyên sau các truy vấn độc hại', async () => {
      expect(await prisma.user.count()).toBeGreaterThan(0);
    });

    it('từ khóa 1 ký tự bị từ chối 400 (hợp đồng cũ không đổi)', async () => {
      await request(http).get('/api/search').query({ q: 'a' }).expect(400);
    });
  });

  describe('thứ tự tất định', () => {
    it('cùng một truy vấn chạy 3 lần cho đúng cùng một thứ tự', async () => {
      const runs = await Promise.all([
        searchSlugs('thien duc'),
        searchSlugs('thien duc'),
        searchSlugs('thien duc'),
      ]);
      expect(runs[1]).toEqual(runs[0]);
      expect(runs[2]).toEqual(runs[0]);
    });

    it('truy vấn có dấu và bỏ dấu cho CÙNG tập kết quả', async () => {
      expect(await searchSlugs('thien duc')).toEqual(
        await searchSlugs('Thiện Đức'),
      );
    });
  });
});
