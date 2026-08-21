import { BadRequestException } from '@nestjs/common';
import {
  EMPTY_DISPLAY_WINDOW,
  assertDisplayWindow,
  bannerPubliclyVisibleWhere,
  isWithinDisplayWindow,
  mergeDisplayWindow,
} from './display-window';

/**
 * Luật cửa sổ hiển thị banner — test đơn vị thẳng vào helper thuần.
 *
 * Ba nhóm tách bạch, đúng ba câu hỏi khác nhau:
 *  1. Cửa sổ nào HỢP LỆ để ghi xuống (`assertDisplayWindow`).
 *  2. Trộn PATCH với giá trị ĐANG LƯU ra cái gì (`mergeDisplayWindow`).
 *  3. Tại một instant thì cửa sổ có ĐỦ ĐIỀU KIỆN không (`isWithinDisplayWindow`)
 *     — đặc biệt tại đúng hai biên.
 */

const at = (iso: string) => new Date(iso);

const FROM = at('2026-09-10T00:00:00.000Z');
const UNTIL = at('2026-09-20T00:00:00.000Z');

describe('assertDisplayWindow — cửa sổ nào ghi được', () => {
  it('cả hai biên NULL: hợp lệ (hành vi banner trước Batch 12)', () => {
    expect(() => assertDisplayWindow(EMPTY_DISPLAY_WINDOW)).not.toThrow();
  });

  it('chỉ có biên dưới: hợp lệ', () => {
    expect(() =>
      assertDisplayWindow({ displayFrom: FROM, displayUntil: null }),
    ).not.toThrow();
  });

  it('chỉ có biên trên: hợp lệ', () => {
    expect(() =>
      assertDisplayWindow({ displayFrom: null, displayUntil: UNTIL }),
    ).not.toThrow();
  });

  it('from < until: hợp lệ', () => {
    expect(() =>
      assertDisplayWindow({ displayFrom: FROM, displayUntil: UNTIL }),
    ).not.toThrow();
  });

  it('from == until: bị từ chối (cửa sổ nửa mở rỗng tuyệt đối)', () => {
    expect(() =>
      assertDisplayWindow({ displayFrom: FROM, displayUntil: new Date(FROM) }),
    ).toThrow(BadRequestException);
  });

  it('from > until: bị từ chối', () => {
    expect(() =>
      assertDisplayWindow({ displayFrom: UNTIL, displayUntil: FROM }),
    ).toThrow(BadRequestException);
  });

  /**
   * Chốt CÓ CHỦ Ý ba luật của `common/schedule-window.ts` KHÔNG áp cho banner.
   * Nếu batch sau muốn đổi thì phải đổi ở đây trước — không được rơi vào bằng
   * cách "tiện tay dùng lại `assertScheduleWindow`".
   */
  describe('không thừa hưởng luật của lịch xuất bản', () => {
    it('cửa sổ bắt đầu ngay bây giờ, dài 30 giây: hợp lệ (không có ngưỡng 1 phút)', () => {
      const now = at('2026-08-21T03:00:00.000Z');
      expect(() =>
        assertDisplayWindow({
          displayFrom: now,
          displayUntil: new Date(now.getTime() + 30_000),
        }),
      ).not.toThrow();
    });

    it('cửa sổ cách hiện tại 5 năm: hợp lệ (không có trần 2 năm)', () => {
      expect(() =>
        assertDisplayWindow({
          displayFrom: at('2031-01-01T00:00:00.000Z'),
          displayUntil: at('2031-02-01T00:00:00.000Z'),
        }),
      ).not.toThrow();
    });

    it('cửa sổ hoàn toàn ở quá khứ: hợp lệ (banner hết hạn vẫn lưu được)', () => {
      expect(() =>
        assertDisplayWindow({
          displayFrom: at('2020-01-01T00:00:00.000Z'),
          displayUntil: at('2020-02-01T00:00:00.000Z'),
        }),
      ).not.toThrow();
    });
  });
});

describe('mergeDisplayWindow — PATCH trộn với giá trị đang lưu', () => {
  const current = { displayFrom: FROM, displayUntil: UNTIL };

  it('không gửi field nào: giữ nguyên cả hai biên', () => {
    expect(mergeDisplayWindow(current, {})).toEqual(current);
  });

  it('gửi null: xoá đúng biên đó, biên kia không đổi', () => {
    expect(mergeDisplayWindow(current, { displayFrom: null })).toEqual({
      displayFrom: null,
      displayUntil: UNTIL,
    });
    expect(mergeDisplayWindow(current, { displayUntil: null })).toEqual({
      displayFrom: FROM,
      displayUntil: null,
    });
  });

  it('gửi null cả hai: về đúng trạng thái "luôn hiển thị" như trước Batch 12', () => {
    expect(
      mergeDisplayWindow(current, { displayFrom: null, displayUntil: null }),
    ).toEqual(EMPTY_DISPLAY_WINDOW);
  });

  it('gửi chuỗi ISO: đổi biên, so sánh theo INSTANT chứ không theo chuỗi', () => {
    const merged = mergeDisplayWindow(EMPTY_DISPLAY_WINDOW, {
      displayFrom: '2026-09-01T08:00:00+07:00',
    });
    expect(merged.displayFrom?.toISOString()).toBe('2026-09-01T01:00:00.000Z');
    expect(merged.displayUntil).toBeNull();
  });

  it('“+07:00” và “Z” cùng instant cho ra cùng một giá trị', () => {
    const offset = mergeDisplayWindow(EMPTY_DISPLAY_WINDOW, {
      displayFrom: '2026-09-01T08:00:00+07:00',
    });
    const utc = mergeDisplayWindow(EMPTY_DISPLAY_WINDOW, {
      displayFrom: '2026-09-01T01:00:00.000Z',
    });
    expect(offset.displayFrom?.getTime()).toBe(utc.displayFrom?.getTime());
  });

  /**
   * Ca chính của §18: DTO nhìn riêng thì không có gì sai, nhưng trạng thái sau
   * khi ghi lại là một cửa sổ đảo ngược.
   */
  it('trộn xong mới lộ ra cửa sổ đảo ngược — DTO một mình không đủ để kết luận', () => {
    const merged = mergeDisplayWindow(current, {
      displayFrom: '2026-09-25T00:00:00.000Z',
    });
    expect(merged.displayUntil).toEqual(UNTIL);
    expect(() => assertDisplayWindow(merged)).toThrow(BadRequestException);
  });

  it('PATCH chỉ displayUntil cũng phải soi lại displayFrom đang lưu', () => {
    const merged = mergeDisplayWindow(current, {
      displayUntil: '2026-09-05T00:00:00.000Z',
    });
    expect(merged.displayFrom).toEqual(FROM);
    expect(() => assertDisplayWindow(merged)).toThrow(BadRequestException);
  });

  it('xoá biên gây xung đột thì cửa sổ trở lại hợp lệ', () => {
    const merged = mergeDisplayWindow(current, {
      displayFrom: '2026-09-25T00:00:00.000Z',
      displayUntil: null,
    });
    expect(() => assertDisplayWindow(merged)).not.toThrow();
  });
});

describe('isWithinDisplayWindow — hành vi tại BIÊN, khoảng nửa mở', () => {
  const now = at('2026-09-15T00:00:00.000Z');
  const past = at('2026-09-01T00:00:00.000Z');
  const future = at('2026-09-30T00:00:00.000Z');

  it('không biên nào: luôn đủ điều kiện', () => {
    expect(isWithinDisplayWindow(EMPTY_DISPLAY_WINDOW, now)).toBe(true);
  });

  it.each([
    ['displayFrom ở tương lai', future, null, false],
    ['displayFrom ĐÚNG BẰNG now', now, null, true],
    ['displayFrom ở quá khứ', past, null, true],
  ])('%s → %s', (_label, from, until, expected) => {
    expect(
      isWithinDisplayWindow({ displayFrom: from, displayUntil: until }, now),
    ).toBe(expected);
  });

  it.each([
    ['displayUntil ở tương lai', null, future, true],
    ['displayUntil ĐÚNG BẰNG now', null, now, false],
    ['displayUntil ở quá khứ', null, past, false],
  ])('%s → %s', (_label, from, until, expected) => {
    expect(
      isWithinDisplayWindow({ displayFrom: from, displayUntil: until }, now),
    ).toBe(expected);
  });

  describe('cửa sổ hai biên [10/09, 20/09)', () => {
    const window = { displayFrom: FROM, displayUntil: UNTIL };

    it.each([
      ['trước khi bắt đầu', '2026-09-09T23:59:59.999Z', false],
      ['ĐÚNG mốc bắt đầu', '2026-09-10T00:00:00.000Z', true],
      ['một mili giây sau mốc bắt đầu', '2026-09-10T00:00:00.001Z', true],
      ['ở giữa', '2026-09-15T00:00:00.000Z', true],
      ['một mili giây trước mốc kết thúc', '2026-09-19T23:59:59.999Z', true],
      ['ĐÚNG mốc kết thúc', '2026-09-20T00:00:00.000Z', false],
      ['sau khi kết thúc', '2026-09-21T00:00:00.000Z', false],
    ])('%s → %s', (_label, instant, expected) => {
      expect(isWithinDisplayWindow(window, at(instant))).toBe(expected);
    });
  });

  /**
   * §39: hàng dị dạng do sửa tay dưới DB. Không có cơ chế sửa chữa lúc chạy —
   * vị từ tự nhiên không bao giờ cho nó hiện, ở BẤT KỲ thời điểm nào.
   */
  it('cửa sổ đảo ngược trong DB: không hiện ở bất kỳ thời điểm nào', () => {
    const broken = { displayFrom: UNTIL, displayUntil: FROM };
    for (const instant of [
      '2026-09-05T00:00:00.000Z',
      '2026-09-15T00:00:00.000Z',
      '2026-09-25T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z',
    ]) {
      expect(isWithinDisplayWindow(broken, at(instant))).toBe(false);
    }
  });
});

describe('bannerPubliclyVisibleWhere — vị từ gửi xuống Prisma', () => {
  const now = at('2026-09-15T00:00:00.000Z');

  it('giữ nguyên công tắc isActive bên cạnh điều kiện thời gian', () => {
    expect(bannerPubliclyVisibleWhere(now)).toEqual({
      isActive: true,
      AND: [
        { OR: [{ displayFrom: null }, { displayFrom: { lte: now } }] },
        { OR: [{ displayUntil: null }, { displayUntil: { gt: now } }] },
      ],
    });
  });

  it('biên trên dùng `gt` chứ không phải `gte` — đúng lúc hết hạn là tắt', () => {
    const where = bannerPubliclyVisibleWhere(now);
    const upper = (where.AND as Record<string, unknown>[])[1];
    expect(JSON.stringify(upper)).toContain('"gt"');
    expect(JSON.stringify(upper)).not.toContain('"gte"');
  });
});
