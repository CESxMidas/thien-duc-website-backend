import { ApiProperty } from '@nestjs/swagger';
import { IsIsoInstant } from '../../common/validators/iso-instant';

/**
 * Thân của `PATCH /news/:slug/schedule` — lệnh đặt/đổi lịch đăng.
 *
 * Cố ý tách khỏi `UpdateNewsPostDto`: sửa nội dung và uỷ quyền đăng trong tương
 * lai là hai hành động khác nhau, khác cả về quyền (EDITOR sửa được, chỉ ADMIN+
 * đặt lịch được). Gộp chung chính là lỗ hổng đã vá ở Batch 1.
 *
 * Chỉ kiểm **hình dạng** ở đây. Các luật nghiệp vụ phụ thuộc thời điểm hiện tại
 * (tối thiểu 60 giây, tối đa 2 năm) nằm ở service, nơi có một `now` duy nhất
 * dùng chung cho cả validate lẫn ghi — xem `news.service.ts`.
 */
export class ScheduleNewsPublicationDto {
  @ApiProperty({
    description:
      'Thời điểm đăng, ISO-8601 **kèm múi giờ tường minh**. Chuỗi không có offset bị từ chối 400 vì nó phụ thuộc múi giờ máy chủ.',
    example: '2026-08-20T08:00:00+07:00',
  })
  @IsIsoInstant()
  scheduledAt!: string;
}
