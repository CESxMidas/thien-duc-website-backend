/**
 * Quy tắc slug chuyên mục tin — **một nguồn sự thật duy nhất** cho toàn backend.
 *
 * Trước đây hệ thống có ba quy tắc khác nhau cho cùng một khái niệm:
 *   - `CreateNewsCategoryDto.slug`  : KHÔNG có ràng buộc hình dạng nào
 *   - `QueryNewsDto.categorySlug`   : `^[a-z0-9]+(?:-[a-z0-9]+)*$`
 *   - admin `SLUG_PATTERN`          : `^[a-z0-9-]+$` (cho phép `--`, `-abc`, `abc-`)
 *
 * Hệ quả đo được: tạo được chuyên mục slug `Tin Dự Án` (201 OK), chip hiện lên
 * website, người dùng bấm vào → frontend gọi `GET /news?categorySlug=Tin%20Dự%20Án`
 * → chính backend từ chối **400** → trang chuyên mục hỏng. Tức là tạo ra một
 * chuyên mục mà website không mở nổi.
 *
 * Quy tắc chốt lấy bản CHẶT NHẤT làm gốc: chữ thường ASCII, số, gạch ngang đơn;
 * không gạch ở đầu/cuối; không hai gạch liền.
 *
 * Cố ý KHÔNG tự chuẩn hoá đầu vào sai (hạ chữ hoa, gộp gạch…): slug là khoá tự
 * nhiên và là URL công khai — sửa ngầm giúp lỗi của client đi lọt và tạo ra một
 * slug khác thứ client tưởng mình vừa tạo. Sai thì trả 400.
 */
export const NEWS_CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Đủ ngắn để không tạo được slug một ký tự vô nghĩa. */
export const NEWS_CATEGORY_SLUG_MIN_LENGTH = 3;

/** Khớp `MAX_SLUG_LENGTH` của Admin để hai phía không lệch nhau. */
export const NEWS_CATEGORY_SLUG_MAX_LENGTH = 160;

export const NEWS_CATEGORY_SLUG_MESSAGE =
  'Slug chỉ gồm chữ thường không dấu, số và dấu gạch ngang đơn (ví dụ: tin-du-an)';

/**
 * Mã lỗi máy đọc được khi từ chối xoá chuyên mục còn bài.
 *
 * `HttpExceptionFilter` lấy `code` của envelope từ field `error` trong body của
 * `HttpException` (xem `common/filters/http-exception.filter.ts`), nên ném
 * `new ConflictException({ error: CATEGORY_IN_USE_CODE, ... })` cho ra
 * `{ success:false, error:{ code:'CATEGORY_IN_USE', ... } }` — Admin bắt theo mã
 * thay vì so khớp chuỗi tiếng Việt.
 */
export const CATEGORY_IN_USE_CODE = 'CATEGORY_IN_USE';
