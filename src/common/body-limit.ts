import { MAX_LONG_TEXT_LENGTH } from './dto/long-translated-text.dto';

/**
 * Trần body JSON của API.
 *
 * Mặc định của Express là **100 kb** — quá thấp từ khi nội dung dài được nâng
 * trần lên 100.000 ký tự/đoạn (`dto/long-translated-text.dto.ts`). Tiếng Việt
 * có dấu chiếm ~1,3 byte/ký tự trong UTF-8, nên 100 kb chỉ tương đương khoảng
 * **80.000 ký tự** (~12.000 từ): nội dung nằm giữa mốc đó và trần DTO mới sẽ bị
 * chặn bằng 413 **trước khi** ValidationPipe chạy — tức phần trần vừa nới ra
 * không bao giờ với tới được.
 *
 * (Bài ~5.000 từ trong ticket gốc chỉ ~42 kb nên vốn đã lọt; đây là chỗ hở lộ
 * ra khi nâng trần, không phải nguyên nhân của lỗi 400 ban đầu.)
 *
 * 2 MB đủ cho bài song ngữ dài nhất trong thực tế (~700.000 ký tự tiếng Việt)
 * mà vẫn là một trần chống payload khổng lồ. Ảnh không đi đường này (upload
 * multipart qua Cloudinary), nên không cần nới thêm cho media.
 */
export const JSON_BODY_LIMIT = '2mb';

/** Số byte tương ứng — dùng để kiểm chứng trần này phủ được trần DTO. */
export const JSON_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

/**
 * Ước lượng byte UTF-8 tệ nhất cho một đoạn dài kịch trần: tiếng Việt có dấu
 * chiếm tối đa 3 byte/ký tự. Trần body phải lớn hơn con số này, nếu không một
 * đoạn hợp lệ theo DTO vẫn bị 413.
 */
export const MAX_PARAGRAPH_BYTES_WORST_CASE = MAX_LONG_TEXT_LENGTH * 3;
