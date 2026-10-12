import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsNotBlank } from '../../common/validators/not-blank';

// Trần độ dài (finding #9 audit): endpoint công khai không đăng nhập — chặn
// payload khổng lồ gây DoS/phình DB. FE đặt `maxLength` khớp các hằng này
// (contact-form.tsx); đổi số ở đây thì đổi cả bên FE.
export class CreateContactSubmissionDto {
  @ApiProperty({
    maxLength: 120,
    description: 'Họ tên người gửi form liên hệ.',
    example: 'Nguyễn Văn A',
  })
  @IsString()
  @MaxLength(120)
  @IsNotBlank()
  name!: string;

  @ApiProperty({
    maxLength: 30,
    description: 'Số điện thoại để bộ phận tư vấn liên hệ lại.',
    example: '0909768001',
  })
  @IsString()
  @MaxLength(30)
  @IsNotBlank()
  phone!: string;

  @ApiProperty({
    required: false,
    maxLength: 200,
    description:
      'Email liên hệ bổ sung, nếu khách muốn nhận phản hồi qua email.',
    example: 'ten@congty.com',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @ApiProperty({
    required: false,
    maxLength: 100,
    description: 'Nhóm nhu cầu khách chọn trên form, ví dụ tu-van-du-an.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  inquiryType?: string;

  @ApiProperty({
    maxLength: 5000,
    description: 'Nội dung yêu cầu tư vấn hoặc thông tin dự án khách quan tâm.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  @IsNotBlank()
  message!: string;
}
