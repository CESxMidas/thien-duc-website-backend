import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// Trần độ dài (finding #9 audit): endpoint công khai không đăng nhập — chặn
// payload khổng lồ gây DoS/phình DB. FE đặt `maxLength` khớp các hằng này
// (contact-form.tsx); đổi số ở đây thì đổi cả bên FE.
export class CreateContactSubmissionDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ maxLength: 30 })
  @IsString()
  @MaxLength(30)
  phone!: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  inquiryType?: string;

  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message!: string;
}
