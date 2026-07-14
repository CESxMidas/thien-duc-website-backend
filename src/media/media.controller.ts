import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseFilePipeBuilder,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { MulterFile } from './types';
import { Role } from '../../generated/prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateMediaAssetDto } from './dto/create-media-asset.dto';
import { MediaService } from './media.service';

/**
 * Ảnh gốc từ máy ảnh/điện thoại thường 4–8MB. Cho phép tới 10MB ở đầu vào rồi
 * để Cloudinary hạ xuống ≤1200px/WebP — ảnh lưu thật sẽ nhỏ hơn 2MB rất nhiều.
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME = /^image\/(jpeg|png|webp|avif)$/;

@ApiTags('media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  @ApiQuery({ name: 'folder', required: false })
  findAll(@Query('folder') folder?: string) {
    return this.mediaService.findAll(folder);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.mediaService.findOne(id);
  }

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiQuery({
    name: 'folder',
    required: false,
    description: 'Thư mục con, vd `projects/la-bonita` hoặc `news/2026`',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  upload(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: ACCEPTED_MIME })
        .addMaxSizeValidator({ maxSize: MAX_UPLOAD_BYTES })
        .build({ fileIsRequired: true }),
    )
    file: MulterFile,
    @CurrentUser() user: { id: string },
    @Query('folder') folder?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Tệp tin rỗng');
    }
    return this.mediaService.upload(file, folder, user.id);
  }

  @Post()
  create(
    @Body() dto: CreateMediaAssetDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.mediaService.create(dto, user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.mediaService.remove(id);
  }
}
