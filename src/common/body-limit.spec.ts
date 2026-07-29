import {
  JSON_BODY_LIMIT,
  JSON_BODY_LIMIT_BYTES,
  MAX_PARAGRAPH_BYTES_WORST_CASE,
} from './body-limit';
import { MAX_LONG_TEXT_LENGTH } from './dto/long-translated-text.dto';

/** Mặc định của Express — con số mà trần mới phải vượt qua. */
const EXPRESS_DEFAULT_BYTES = 100 * 1024;

describe('trần body JSON', () => {
  it('lớn hơn mặc định 100 kb của Express', () => {
    expect(JSON_BODY_LIMIT_BYTES).toBeGreaterThan(EXPRESS_DEFAULT_BYTES);
  });

  it('chuỗi cấu hình khớp số byte dùng để kiểm chứng', () => {
    expect(JSON_BODY_LIMIT).toBe('2mb');
    expect(JSON_BODY_LIMIT_BYTES).toBe(2 * 1024 * 1024);
  });

  /**
   * Chốt chặn thật sự: nếu ai đó nâng `MAX_LONG_TEXT_LENGTH` mà quên nới trần
   * body, một đoạn hợp lệ theo DTO vẫn bị 413 trước khi ValidationPipe chạy.
   */
  it('đủ chỗ cho một đoạn kịch trần DTO ở trường hợp UTF-8 tệ nhất', () => {
    expect(MAX_PARAGRAPH_BYTES_WORST_CASE).toBe(MAX_LONG_TEXT_LENGTH * 3);
    expect(JSON_BODY_LIMIT_BYTES).toBeGreaterThan(
      MAX_PARAGRAPH_BYTES_WORST_CASE,
    );
  });

  it('bài ~5.000 từ tiếng Việt (ca lỗi gốc) lọt cả trần cũ lẫn trần mới', () => {
    // ~5.000 từ ≈ 33.000 ký tự ≈ 42 kb: vốn đã dưới mặc định 100 kb, nên lỗi
    // gốc đúng là 400 từ ValidationPipe chứ không phải 413.
    const article = 'nội dung bài viết dài '.repeat(1_500);
    const bytes = Buffer.byteLength(article, 'utf8');

    expect(article.length).toBeGreaterThan(5_000);
    expect(bytes).toBeLessThan(EXPRESS_DEFAULT_BYTES);
    expect(bytes).toBeLessThan(JSON_BODY_LIMIT_BYTES);
  });

  it('một đoạn kịch trần DTO thì vượt mặc định cũ — lý do phải nới', () => {
    // Đây mới là vùng bị 413 nếu giữ nguyên 100 kb: trần DTO cho phép 100.000
    // ký tự, nhưng 100 kb chỉ chứa được khoảng 80.000 ký tự tiếng Việt.
    const maxParagraph = 'nội dung bài viết dài '.repeat(
      Math.floor(MAX_LONG_TEXT_LENGTH / 22),
    );
    const bytes = Buffer.byteLength(maxParagraph, 'utf8');

    expect(maxParagraph.length).toBeLessThanOrEqual(MAX_LONG_TEXT_LENGTH);
    // Hợp lệ theo DTO nhưng vẫn vượt 100 kb → đúng vùng bị 413 nếu không nới.
    expect(bytes).toBeGreaterThan(EXPRESS_DEFAULT_BYTES);
    expect(bytes).toBeLessThan(JSON_BODY_LIMIT_BYTES);
  });
});
