import { ApiProperty } from '@nestjs/swagger';
import { IsIsoInstant } from '../../common/validators/iso-instant';

/**
 * Thân của `PATCH /cooperation/:id/schedule` — lệnh đặt/đổi lịch đăng dự án
 * hợp tác.
 *
 * Cố ý tách khỏi `UpdateCooperationProjectDto`: sửa nội dung và uỷ quyền đăng
 * trong tương lai là hai hành động khác nhau, khác cả về quyền (EDITOR sửa được
 * bản nháp, chỉ ADMIN+ đặt lịch được). Đây cũng là điều giữ nguyên vẹn chốt
 * chặn của Batch 6: DTO nội dung không mang bất kỳ field xuất bản nào.
 *
 * Chỉ kiểm **hình dạng** ở đây. Các luật phụ thuộc thời điểm hiện tại (tối thiểu
 * 60 giây, tối đa 2 năm) nằm ở service qua `assertScheduleWindow` — dùng chung
 * với Tin tức và Dự án, không có bản sao ngưỡng thứ ba.
 */
export class ScheduleCooperationPublicationDto {
  @ApiProperty({
    description:
      'Thời điểm đăng, ISO-8601 **kèm múi giờ tường minh**. Chuỗi không có offset bị từ chối 400 vì nó phụ thuộc múi giờ máy chủ.',
    example: '2026-08-20T08:00:00+07:00',
  })
  @IsIsoInstant()
  scheduledAt!: string;
}
