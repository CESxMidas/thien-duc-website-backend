import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { ReorderBannersDto } from './dto/reorder-banners.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

@ApiTags('banners')
@Controller('banners')
export class BannersController {
  constructor(private readonly bannersService: BannersService) {}

  /** Trang chủ chỉ lấy banner đang bật. */
  @Get()
  findAll() {
    return this.bannersService.findAll(true);
  }

  // Các route tĩnh (`admin`, `reorder`) phải khai báo trước `:id`,
  // nếu không Nest sẽ khớp chúng vào tham số id.

  /** Danh sách cho Admin CMS: kèm cả banner đã tắt. */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('admin')
  findAllForAdmin() {
    return this.bannersService.findAll(false);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('admin/:id')
  findOne(@Param('id') id: string) {
    return this.bannersService.findOne(id);
  }

  // Banner là nội dung trang chủ, mức hiển thị cao và không có luồng duyệt riêng.
  // Vì vậy mọi thao tác thay đổi (tạo/sửa/bật-tắt/sắp xếp/xóa) chỉ cho ADMIN trở
  // lên — EDITOR không được tự đẩy banner lên trang chủ.

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch('reorder')
  reorder(@Body() dto: ReorderBannersDto) {
    return this.bannersService.reorder(dto.bannerIds);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post()
  create(@Body() dto: CreateBannerDto) {
    return this.bannersService.create(dto);
  }

  // Bật/tắt banner (`isActive`) đi qua chính route update này — chốt ADMIN+ ở đây
  // là đã bao trọn thao tác toggle, không cần route riêng.
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBannerDto) {
    return this.bannersService.update(id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.bannersService.remove(id);
  }
}
