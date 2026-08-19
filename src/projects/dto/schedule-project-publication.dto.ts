import { ApiProperty } from '@nestjs/swagger';
import { IsIsoInstant } from '../../common/validators/iso-instant';

/**
 * Thân của `PATCH /projects/:slug/schedule` — lệnh đặt/đổi lịch đăng dự án.
 *
 * Cố ý tách khỏi `UpdateProjectDto`: sửa nội dung và uỷ quyền đăng trong tương
 * lai là hai hành động khác nhau, khác cả về quyền (EDITOR sửa được bản nháp,
 * chỉ ADMIN+ đặt lịch được).
 *
 * DTO riêng cho dự án thay vì dùng lại lớp của tin tức: phần **thật sự chung**
 * là quy tắc định dạng, và nó đã nằm ở `common/validators/iso-instant.ts` (một
 * chỗ duy nhất). Bản thân lớp DTO chỉ là một field — chép một dòng còn hơn để
 * module Dự án phải import một lớp mang tên `...News...`.
 *
 * Chỉ kiểm **hình dạng** ở đây. Các luật phụ thuộc thời điểm hiện tại (tối thiểu
 * 60 giây, tối đa 2 năm) nằm ở service qua `assertScheduleWindow`, nơi có một
 * `now` duy nhất dùng chung cho cả validate lẫn ghi.
 */
export class ScheduleProjectPublicationDto {
  @ApiProperty({
    description:
      'Thời điểm đăng, ISO-8601 **kèm múi giờ tường minh**. Chuỗi không có offset bị từ chối 400 vì nó phụ thuộc múi giờ máy chủ.',
    example: '2026-08-20T08:00:00+07:00',
  })
  @IsIsoInstant()
  scheduledAt!: string;
}
