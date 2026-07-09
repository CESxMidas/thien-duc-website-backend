import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ReorderGalleryDto {
  @ApiProperty({
    type: [String],
    description:
      'Toàn bộ id ảnh của dự án, xếp theo thứ tự hiển thị mong muốn (đầu danh sách hiện trước).',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  imageIds!: string[];
}
