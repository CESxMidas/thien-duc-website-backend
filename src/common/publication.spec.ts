import { ContentStatus, Prisma } from '../../generated/prisma/client';
import {
  isPubliclyVisible,
  newsPubliclyVisibleSql,
  publiclyVisibleWhere,
  type PublishableRecord,
} from './publication';

/**
 * Luật hiển thị công khai là **ranh giới bảo mật** — mọi bề mặt công khai của
 * tin tức (danh sách, chi tiết, phân trang, tìm kiếm, đếm chuyên mục) đều đi
 * qua đúng ba hàm trong file này. Ma trận dưới đây là đặc tả của ranh giới đó.
 *
 * Mốc thời gian cố định: 2026-08-20T01:00:00.000Z = 08:00 giờ Việt Nam. Không
 * dùng đồng hồ thật ở bất kỳ đâu nên test không bao giờ flaky quanh nửa đêm hay
 * đổi kết quả theo múi giờ của máy chạy CI.
 */
const NOW = new Date('2026-08-20T01:00:00.000Z');
const ONE_HOUR = 60 * 60 * 1000;
const PAST = new Date(NOW.getTime() - ONE_HOUR);
const FUTURE = new Date(NOW.getTime() + ONE_HOUR);

/** [nhãn, bản ghi, có được công khai không] */
const matrix: Array<[string, PublishableRecord, boolean]> = [
  [
    'PUBLISHED, không có lịch → công khai',
    { status: ContentStatus.PUBLISHED, scheduledAt: null },
    true,
  ],
  [
    'PUBLISHED kèm lịch tương lai (dữ liệu cũ) → vẫn công khai',
    { status: ContentStatus.PUBLISHED, scheduledAt: FUTURE },
    true,
  ],
  [
    'PENDING + lịch tương lai → RIÊNG TƯ',
    { status: ContentStatus.PENDING, scheduledAt: FUTURE },
    false,
  ],
  [
    'PENDING + lịch quá hạn → công khai (dù reconciler chưa chạy)',
    { status: ContentStatus.PENDING, scheduledAt: PAST },
    true,
  ],
  [
    'PENDING + lịch ĐÚNG khoảnh khắc đáo hạn → công khai (biên <=)',
    { status: ContentStatus.PENDING, scheduledAt: new Date(NOW.getTime()) },
    true,
  ],
  [
    'PENDING không có lịch (hàng chờ duyệt thường) → RIÊNG TƯ',
    { status: ContentStatus.PENDING, scheduledAt: null },
    false,
  ],
  [
    'DRAFT + lịch quá hạn (dị dạng) → RIÊNG TƯ — chốt phòng thủ nhiều lớp',
    { status: ContentStatus.DRAFT, scheduledAt: PAST },
    false,
  ],
  [
    'DRAFT không có lịch → RIÊNG TƯ',
    { status: ContentStatus.DRAFT, scheduledAt: null },
    false,
  ],
];

describe('isPubliclyVisible — vị từ trên bản ghi đã nạp', () => {
  it.each(matrix)('%s', (_label, record, expected) => {
    expect(isPubliclyVisible(record, NOW)).toBe(expected);
  });

  it('trễ một mili giây so với giờ hẹn vẫn RIÊNG TƯ', () => {
    expect(
      isPubliclyVisible(
        {
          status: ContentStatus.PENDING,
          scheduledAt: new Date(NOW.getTime() + 1),
        },
        NOW,
      ),
    ).toBe(false);
  });

  it('so sánh theo instant, không theo tham chiếu Date', () => {
    // Hai đối tượng Date khác nhau nhưng cùng một thời điểm.
    expect(
      isPubliclyVisible(
        {
          status: ContentStatus.PENDING,
          scheduledAt: new Date('2026-08-20T01:00:00.000Z'),
        },
        new Date('2026-08-20T01:00:00.000Z'),
      ),
    ).toBe(true);
  });
});

describe('publiclyVisibleWhere — mảnh where cho Prisma', () => {
  it('gồm ĐÚNG hai nhánh: PUBLISHED, và PENDING đã tới hạn', () => {
    expect(publiclyVisibleWhere(NOW)).toEqual({
      OR: [
        { status: ContentStatus.PUBLISHED },
        {
          status: ContentStatus.PENDING,
          scheduledAt: { not: null, lte: NOW },
        },
      ],
    });
  });

  it('nhánh lịch BẮT BUỘC kèm status PENDING — không có nhánh "chỉ scheduledAt"', () => {
    // Nếu nhánh thứ hai chỉ lọc theo `scheduledAt <= now` mà không chốt trạng
    // thái, một hàng DRAFT mang lịch quá hạn sẽ lọt ra công khai. Đây chính là
    // luật phòng thủ được duyệt sau audit; khẳng định nó ở tầng cấu trúc để
    // không ai "rút gọn" điều kiện cho ngắn.
    const branches = publiclyVisibleWhere(NOW).OR as Array<
      Record<string, unknown>
    >;
    for (const branch of branches) {
      expect(branch.status).toBeDefined();
    }
    expect(branches).toHaveLength(2);
  });

  it('dùng `lte` (bao gồm khoảnh khắc đáo hạn), không phải `lt`', () => {
    const scheduledBranch = (
      publiclyVisibleWhere(NOW).OR as Array<{
        scheduledAt?: Record<string, unknown>;
      }>
    )[1];

    expect(scheduledBranch.scheduledAt).toHaveProperty('lte');
    expect(scheduledBranch.scheduledAt).not.toHaveProperty('lt');
  });
});

describe('newsPubliclyVisibleSql — mảnh SQL cho tìm kiếm', () => {
  it('`now` đi qua bind parameter, KHÔNG nội suy vào chuỗi SQL', () => {
    const fragment = newsPubliclyVisibleSql(NOW);

    expect(fragment).toBeInstanceOf(Prisma.Sql);
    expect(fragment.values).toEqual([NOW]);
    // Giá trị thời gian không được xuất hiện dưới dạng chữ trong câu lệnh.
    expect(fragment.sql).not.toContain('2026');
  });

  it('giữ đủ ba mệnh đề của nhánh lịch + nhánh PUBLISHED', () => {
    const { sql } = newsPubliclyVisibleSql(NOW);

    expect(sql).toContain(`n."status" = 'PUBLISHED'`);
    expect(sql).toContain(`n."status" = 'PENDING'`);
    expect(sql).toContain('n."scheduled_at" IS NOT NULL');
    expect(sql).toContain('n."scheduled_at" <=');
  });

  it('bọc trong ngoặc — nối bằng AND ở câu ngoài không làm hỏng thứ tự OR', () => {
    // `WHERE <fragment> AND ...` mà thiếu ngoặc thì AND sẽ hút mất nhánh cuối
    // của OR, và bài nháp lọt ra kết quả tìm kiếm.
    const { sql } = newsPubliclyVisibleSql(NOW);

    expect(sql.trim().startsWith('(')).toBe(true);
    expect(sql.trim().endsWith(')')).toBe(true);
  });
});
