import { isIsoInstant } from './iso-instant';

/**
 * Vị từ này là hàng rào chống một lỗi âm thầm: mốc thời gian **không có múi
 * giờ** được diễn giải theo múi giờ của tiến trình đang chạy. Backend chạy UTC
 * (Render), biên tập viên chạy UTC+7 — lệch 7 tiếng, không ai báo lỗi.
 */
describe('isIsoInstant', () => {
  describe('chấp nhận', () => {
    it.each([
      ['giờ VN kèm offset', '2026-08-20T08:00:00+07:00'],
      ['Zulu', '2026-08-20T01:00:00Z'],
      ['offset âm', '2026-08-19T18:00:00-07:00'],
      ['mili giây', '2026-08-20T01:00:00.123Z'],
      ['một chữ số mili giây', '2026-08-20T01:00:00.5Z'],
      ['bỏ giây', '2026-08-20T01:00Z'],
      ['năm nhuận 29/02', '2028-02-29T01:00:00Z'],
    ])('%s', (_label, value) => {
      expect(isIsoInstant(value)).toBe(true);
    });
  });

  describe('từ chối — thiếu múi giờ (lý do chính file này tồn tại)', () => {
    it.each([
      ['giờ trần', '2026-08-20T08:00'],
      ['có giây, không offset', '2026-08-20T08:00:00'],
      ['có mili giây, không offset', '2026-08-20T08:00:00.000'],
    ])('%s', (_label, value) => {
      expect(isIsoInstant(value)).toBe(false);
    });
  });

  describe('từ chối — sai hình dạng', () => {
    it.each([
      ['dấu cách thay T (kiểu SQL)', '2026-08-20 08:00:00+07:00'],
      ['chỉ có ngày', '2026-08-20'],
      ['offset thiếu phút', '2026-08-20T08:00:00+07'],
      ['rác', 'khong-phai-ngay'],
      ['chuỗi rỗng', ''],
      ['epoch dạng số trong chuỗi', '1755657600000'],
    ])('%s', (_label, value) => {
      expect(isIsoInstant(value)).toBe(false);
    });
  });

  describe('từ chối — giá trị không tồn tại trên lịch/đồng hồ', () => {
    it.each([
      ['31/02', '2026-02-31T08:00:00+07:00'],
      ['29/02 năm KHÔNG nhuận', '2026-02-29T08:00:00+07:00'],
      ['31/04', '2026-04-31T08:00:00Z'],
      ['tháng 13', '2026-13-01T08:00:00Z'],
      ['ngày 00', '2026-08-00T08:00:00Z'],
      ['giờ 25', '2026-08-20T25:00:00+07:00'],
    ])('%s', (_label, value) => {
      // V8 CUỘN ngày quá biên (31/02 → 03/03) thay vì trả NaN, nên nếu chỉ dựa
      // vào `Date.parse` thì bài sẽ lên muộn mấy ngày mà không hề báo lỗi.
      expect(isIsoInstant(value)).toBe(false);
    });
  });

  describe('từ chối — không phải chuỗi', () => {
    it.each([
      ['number', 1_755_657_600_000],
      ['Date', new Date()],
      ['null', null],
      ['undefined', undefined],
      ['object', {}],
    ])('%s', (_label, value) => {
      expect(isIsoInstant(value)).toBe(false);
    });
  });

  it('hai cách viết cùng một instant đều hợp lệ và bằng nhau', () => {
    const viaOffset = '2026-08-20T08:00:00+07:00';
    const viaZulu = '2026-08-20T01:00:00Z';

    expect(isIsoInstant(viaOffset)).toBe(true);
    expect(isIsoInstant(viaZulu)).toBe(true);
    expect(new Date(viaOffset).getTime()).toBe(new Date(viaZulu).getTime());
  });
});
