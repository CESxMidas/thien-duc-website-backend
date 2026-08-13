import { Test } from '@nestjs/testing';
import { ContentStatus, Prisma } from '../../generated/prisma/client';
import { isPubliclyVisible } from '../common/publication';
import { PrismaService } from '../prisma/prisma.service';
import { SearchService } from './search.service';

/**
 * Tìm kiếm là bề mặt công khai **dễ bỏ quên nhất** khi luật hiển thị đổi: nó là
 * truy vấn tin duy nhất viết bằng SQL thô, nên một helper `where` của Prisma
 * không chạm tới được. Bỏ sót ở đây nghĩa là bài chưa tới giờ vẫn tìm ra được
 * qua ô tìm kiếm dù mọi trang khác đã ẩn nó.
 *
 * Bài test kiểm hai tầng:
 *  1. Câu SQL mà SearchService thật sự gửi đi có mang đủ mệnh đề hay không.
 *  2. Ma trận trạng thái, xác thực bằng chính vị từ dùng chung — để đặc tả của
 *     search không trôi khỏi đặc tả của phần còn lại.
 */
const NOW = new Date('2026-08-20T01:00:00.000Z'); // 08:00 giờ VN
const ONE_HOUR = 60 * 60 * 1000;
const PAST = new Date(NOW.getTime() - ONE_HOUR);
const FUTURE = new Date(NOW.getTime() + ONE_HOUR);

describe('SearchService — tin đã lên lịch', () => {
  let service: SearchService;
  let queryRaw: jest.Mock;

  beforeEach(async () => {
    queryRaw = jest.fn().mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: queryRaw,
            project: { findMany: jest.fn().mockResolvedValue([]) },
            newsPost: { findMany: jest.fn().mockResolvedValue([]) },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(SearchService);
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Ghép template literal + các mảnh Sql lồng nhau thành SQL phẳng. */
  function flatSqlAt(index: number): string {
    const call = queryRaw.mock.calls[index] as unknown[];
    const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
    return strings
      .map((chunk, i) => {
        const value: unknown = values[i];
        return chunk + (value instanceof Prisma.Sql ? value.sql : '');
      })
      .join('')
      .replace(/\s+/g, ' ');
  }

  /** Toàn bộ giá trị bind, gồm cả giá trị nằm trong mảnh Sql lồng nhau. */
  function bindValuesAt(index: number): unknown[] {
    const call = queryRaw.mock.calls[index] as unknown[];
    const [, ...values] = call as [TemplateStringsArray, ...unknown[]];
    return values.flatMap((value: unknown) =>
      value instanceof Prisma.Sql ? value.values : [value],
    );
  }

  describe('câu SQL gửi đi', () => {
    it('không còn lọc cứng `status = PUBLISHED` mà dùng luật đầy đủ', async () => {
      await service.search({ q: 'thiên đức', type: 'news', limit: 10 });

      const sql = flatSqlAt(0);
      expect(sql).toContain(`n."status" = 'PUBLISHED'`);
      expect(sql).toContain(`n."status" = 'PENDING'`);
      expect(sql).toContain('n."scheduled_at" IS NOT NULL');
      expect(sql).toContain('n."scheduled_at" <=');
    });

    it('mốc thời gian đi qua bind parameter, không nội suy chuỗi', async () => {
      await service.search({ q: 'thiên đức', type: 'news', limit: 10 });

      // `toContainEqual`: service tự tạo `new Date()` nên là đối tượng khác,
      // cùng thời điểm — so sánh theo giá trị mới đúng ý.
      expect(bindValuesAt(0)).toContainEqual(NOW);
      expect(flatSqlAt(0)).not.toContain('2026-08-20');
    });

    it('nhánh lịch kèm PENDING — bài nháp mang lịch quá hạn không lọt vào kết quả', async () => {
      await service.search({ q: 'thiên đức', type: 'news', limit: 10 });

      // Chuỗi `scheduled_at <=` không được đứng một mình như một nhánh OR độc
      // lập; nó phải nằm sau điều kiện PENDING.
      const sql = flatSqlAt(0);
      const pendingAt = sql.indexOf(`n."status" = 'PENDING'`);
      const scheduleAt = sql.indexOf('n."scheduled_at" IS NOT NULL');
      expect(pendingAt).toBeGreaterThan(-1);
      expect(scheduleAt).toBeGreaterThan(pendingAt);
    });

    it('KHÔNG đổi điều kiện của Dự án — Projects thuộc batch sau', async () => {
      await service.search({ q: 'thiên đức', type: 'projects', limit: 10 });

      const sql = flatSqlAt(0);
      expect(sql).toContain(`p."content_status" = 'PUBLISHED'`);
      expect(sql).not.toContain('scheduled_at');
    });

    it('một lượt tìm kiếm gộp chỉ dùng MỘT mốc thời gian', async () => {
      await service.search({ q: 'thiên đức', type: 'all', limit: 10 });

      // Hai nhánh chạy song song; chỉ nhánh tin mang `now`, và đúng một giá trị.
      const allBinds = [...bindValuesAt(0), ...bindValuesAt(1)];
      const dates = allBinds.filter((value) => value instanceof Date);
      expect(dates).toEqual([NOW]);
    });
  });

  /**
   * Ma trận trạng thái. Search không tự định nghĩa luật — nó dùng lại
   * `newsPubliclyVisibleSql`, vốn phát biểu đúng cùng một điều kiện với
   * `isPubliclyVisible`. Khẳng định qua vị từ dùng chung giữ hai bên không trôi
   * khỏi nhau, thay vì so khớp chuỗi SQL một cách giòn gãy.
   */
  describe('ma trận trạng thái tin trong kết quả tìm kiếm', () => {
    it.each([
      ['PUBLISHED → có trong kết quả', ContentStatus.PUBLISHED, null, true],
      [
        'PENDING + lịch tương lai → bị loại',
        ContentStatus.PENDING,
        FUTURE,
        false,
      ],
      [
        'PENDING + lịch đã tới hạn → có trong kết quả',
        ContentStatus.PENDING,
        PAST,
        true,
      ],
      ['PENDING không có lịch → bị loại', ContentStatus.PENDING, null, false],
      [
        'DRAFT + lịch quá hạn (dị dạng) → bị loại',
        ContentStatus.DRAFT,
        PAST,
        false,
      ],
    ])('%s', (_label, status, scheduledAt, expected) => {
      expect(isPubliclyVisible({ status, scheduledAt }, NOW)).toBe(expected);
    });
  });
});
