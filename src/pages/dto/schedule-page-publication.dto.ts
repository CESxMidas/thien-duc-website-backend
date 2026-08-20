import { ApiProperty } from '@nestjs/swagger';
import { IsIsoInstant } from '../../common/validators/iso-instant';

/**
 * Thân của `PATCH /pages/:slug/schedule` — lệnh đặt/đổi lịch đăng trang.
 *
 * Cố ý tách khỏi `UpdatePageDto`: sửa nội dung và uỷ quyền đăng trong tương lai
 * là hai hành động khác nhau, khác cả về quyền (EDITOR sửa được bản nháp, chỉ
 * ADMIN+ đặt lịch được). Đây cũng là điều giữ nguyên vẹn ranh giới ghi: DTO nội
 * dung không mang bất kỳ field xuất bản nào.
 *
 * Chỉ kiểm **hình dạng** ở đây. Các luật phụ thuộc thời điểm hiện tại (tối thiểu
 * 60 giây, tối đa 2 năm) nằm ở service qua `assertScheduleWindow` — dùng chung
 * với Tin tức, Dự án và Dự án hợp tác, không có bản sao ngưỡng thứ tư.
 */
export class SchedulePagePublicationDto {
  @ApiProperty({
    description:
      'Thời điểm đăng, ISO-8601 **kèm múi giờ tường minh**. Chuỗi không có offset bị từ chối 400 vì nó phụ thuộc múi giờ máy chủ.',
    example: '2026-08-20T08:00:00+07:00',
  })
  @IsIsoInstant()
  scheduledAt!: string;
}
