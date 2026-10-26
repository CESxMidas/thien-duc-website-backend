import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';

export class ReorderContentDto {
  @ApiProperty({
    type: [String],
    description: 'Toàn bộ ID trong danh sách, theo thứ tự muốn hiển thị.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids!: string[];
}
