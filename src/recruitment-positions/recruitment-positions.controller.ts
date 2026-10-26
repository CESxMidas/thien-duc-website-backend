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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../generated/prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateRecruitmentPositionDto } from './dto/create-recruitment-position.dto';
import { UpdateRecruitmentPositionDto } from './dto/update-recruitment-position.dto';
import { RecruitmentPositionsService } from './recruitment-positions.service';
import { ReorderContentDto } from '../common/dto/reorder-content.dto';

@ApiTags('recruitment-positions')
@Controller('recruitment-positions')
export class RecruitmentPositionsController {
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sắp xếp vị trí tuyển dụng.' })
  @ApiResponse({ status: 200, description: 'Đã lưu thứ tự.' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch('admin/reorder')
  reorder(@Body() dto: ReorderContentDto) {
    return this.recruitmentPositionsService.reorder(dto.ids);
  }

  constructor(
    private readonly recruitmentPositionsService: RecruitmentPositionsService,
  ) {}

  @ApiOperation({
    summary: 'Danh sách vị trí tuyển dụng đang mở (công khai).',
    description:
      'Chỉ trả vị trí PUBLISHED chưa hết hạn. Hạn được tính trọn ngày theo múi giờ Asia/Ho_Chi_Minh.',
  })
  @ApiResponse({
    status: 200,
    description:
      'deadline trong response luôn có định dạng YYYY-MM-DD hoặc null.',
  })
  @Get()
  findAllPublic() {
    return this.recruitmentPositionsService.findAllPublic();
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Danh sách đầy đủ cho Admin CMS — gồm nháp, chờ duyệt và đã đăng.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('admin')
  findAllForAdmin() {
    return this.recruitmentPositionsService.findAllForAdmin();
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Chi tiết vị trí tuyển dụng cho Admin CMS.' })
  @ApiResponse({
    status: 404,
    description: 'Không tìm thấy vị trí tuyển dụng.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Get('admin/:id')
  findOneForAdmin(@Param('id') id: string) {
    return this.recruitmentPositionsService.findOneForAdmin(id);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Tạo vị trí tuyển dụng.',
    description:
      'Vị trí mới mặc định ở DRAFT. EDITOR chỉ được tạo nháp; ADMIN/SUPER_ADMIN có thể chọn DRAFT, PENDING hoặc PUBLISHED.',
  })
  @ApiResponse({ status: 201, description: 'Đã tạo vị trí tuyển dụng.' })
  @ApiResponse({ status: 400, description: 'Payload không hợp lệ.' })
  @ApiResponse({
    status: 403,
    description: 'EDITOR chỉ được tạo vị trí ở trạng thái DRAFT.',
  })
  @ApiResponse({ status: 409, description: 'Slug đã tồn tại.' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Post()
  create(
    @Body() dto: CreateRecruitmentPositionDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.recruitmentPositionsService.create(dto, user.role);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cập nhật từng phần vị trí tuyển dụng.',
    description:
      'EDITOR chỉ được sửa bản nháp và có thể chuyển DRAFT → PENDING để gửi duyệt. EDITOR không được đăng trực tiếp, sửa bản đã gửi duyệt/đã đăng hoặc chuyển trạng thái lùi về.',
  })
  @ApiResponse({ status: 400, description: 'Payload không hợp lệ.' })
  @ApiResponse({
    status: 403,
    description: 'Không đủ quyền sửa trạng thái hiện tại.',
  })
  @ApiResponse({
    status: 404,
    description: 'Không tìm thấy vị trí tuyển dụng.',
  })
  @ApiResponse({ status: 409, description: 'Slug đã tồn tại.' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRecruitmentPositionDto,
    @CurrentUser() user: { role: string },
  ) {
    return this.recruitmentPositionsService.update(id, dto, user.role);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Chuyển vị trí tuyển dụng vào thùng rác (endpoint cũ, chỉ Super Admin).',
  })
  @ApiResponse({
    status: 404,
    description: 'Không tìm thấy vị trí tuyển dụng.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() actor: { id: string }) {
    return this.recruitmentPositionsService.remove(id, actor.id);
  }
}
