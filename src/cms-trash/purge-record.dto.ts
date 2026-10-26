import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';

export class PurgeRecordDto {
  @ApiProperty({
    example: true,
    description: 'Xác nhận đã hiểu thao tác không thể khôi phục.',
  })
  @IsBoolean()
  @Equals(true)
  confirm!: boolean;
}
