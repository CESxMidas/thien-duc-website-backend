import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ReorderCooperationProjectsDto {
  @ApiProperty({
    type: [String],
    description:
      'Toàn bộ id dự án hợp tác, xếp theo thứ tự hiển thị mong muốn (đầu danh sách hiện trước).',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  cooperationProjectIds!: string[];
}
