import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { MulterFile } from '../media/types';
import { CreateJobApplicationDto } from './dto/create-job-application.dto';
import {
  JobApplicationsService,
  MAX_CV_BYTES,
} from './job-applications.service';

@ApiTags('recruitment-positions')
@Controller('recruitment-positions')
export class JobApplicationsController {
  constructor(private readonly applications: JobApplicationsService) {}

  @Post(':id/applications')
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @ApiOperation({ summary: 'Gửi hồ sơ ứng tuyển cho vị trí còn nhận hồ sơ.' })
  @ApiResponse({
    status: 201,
    description: 'Đã lưu hồ sơ, không trả thông tin CV ra công khai.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'phone', 'email'],
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        cvLink: { type: 'string' },
        message: { type: 'string' },
        locale: { type: 'string', enum: ['vi', 'en'] },
        company: { type: 'string' },
        cv: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('cv', {
      limits: {
        fileSize: MAX_CV_BYTES,
        files: 1,
        fields: 7,
        fieldSize: 16 * 1024,
      },
    }),
  )
  create(
    @Param('id') id: string,
    @Body() dto: CreateJobApplicationDto,
    @UploadedFile() file: MulterFile | undefined,
    @Req() req: Request,
  ) {
    return this.applications.create(id, dto, file, req.ip);
  }
}
