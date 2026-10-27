import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Role } from '../../generated/prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ContactService } from './contact.service';
import { CreateContactSubmissionDto } from './dto/create-contact-submission.dto';
import { UpdateContactSubmissionDto } from './dto/update-contact-submission.dto';

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @Post()
  create(@Body() dto: CreateContactSubmissionDto, @Req() req: Request) {
    return this.contactService.create(dto, req.ip);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get(':id/cv')
  @ApiOperation({ summary: 'Tải CV riêng tư của hồ sơ ứng tuyển.' })
  @ApiResponse({
    status: 200,
    description: 'File PDF tải xuống, yêu cầu quyền quản trị.',
  })
  async downloadCv(@Param('id') id: string, @Res() response: Response) {
    const file = await this.contactService.downloadCv(id);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="CV.pdf"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    response.send(Buffer.from(file.content));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get()
  findAll() {
    return this.contactService.findAll();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contactService.findOne(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateContactSubmissionDto) {
    return this.contactService.update(id, dto);
  }
}
