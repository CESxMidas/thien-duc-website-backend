import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProfileChangeStatus, Role } from '../../generated/prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateAccountInvitationDto } from './dto/create-account-invitation.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ReviewProfileRequestDto } from './dto/review-profile-request.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

type Actor = { id: string; role: Role };

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  // --- Hồ sơ cá nhân + luồng duyệt ---
  // Khai báo TRƯỚC route ':id' để '/users/me' không bị coi là id = "me".

  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Hồ sơ của người đang đăng nhập (kèm yêu cầu chờ duyệt)',
  })
  @Get('me')
  getMyProfile(@CurrentUser() actor: Actor) {
    return this.usersService.getMyProfile(actor.id);
  }

  @Roles(Role.EDITOR, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Gửi cập nhật hồ sơ (EDITOR chờ duyệt, admin áp thẳng)',
  })
  @Patch('me')
  updateMyProfile(@Body() dto: UpdateProfileDto, @CurrentUser() actor: Actor) {
    return this.usersService.submitProfileChange(actor.id, dto, actor.role);
  }

  @ApiOperation({ summary: 'Danh sách yêu cầu cập nhật hồ sơ chờ duyệt' })
  @Get('profile-requests')
  listProfileRequests(@Query('status') status?: ProfileChangeStatus) {
    return this.usersService.listProfileRequests(status);
  }

  @ApiOperation({ summary: 'Duyệt / từ chối một yêu cầu cập nhật hồ sơ' })
  @Patch('profile-requests/:id')
  reviewProfileRequest(
    @Param('id') id: string,
    @Body() dto: ReviewProfileRequestDto,
    @CurrentUser() actor: Actor,
  ) {
    return this.usersService.reviewProfileRequest(id, dto, actor.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  // ⚠️ Đường tạo trực tiếp bằng mật khẩu (POST /users, ở trên) vẫn giữ tạm
  // thời trong Phase 2A — sẽ được xem xét loại bỏ sau khi luồng lời mời ổn
  // định (xem CMS-ACCOUNT-INVITATION-GREENFIELD-AUDIT-M1 §L).
  @ApiOperation({
    summary: 'Tạo tài khoản qua lời mời — SUPER_ADMIN không đặt mật khẩu',
  })
  @Roles(Role.SUPER_ADMIN)
  @Post('invitations')
  createInvitation(
    @Body() dto: CreateAccountInvitationDto,
    @CurrentUser() actor: Actor,
  ) {
    return this.usersService.createInvitation(dto, actor.id);
  }

  @ApiOperation({ summary: 'Gửi lại lời mời thiết lập tài khoản' })
  @Roles(Role.SUPER_ADMIN)
  @Post(':id/resend-invitation')
  resendInvitation(@Param('id') id: string, @CurrentUser() actor: Actor) {
    return this.usersService.resendInvitation(id, actor.id);
  }

  @ApiOperation({ summary: 'Thu hồi lời mời thiết lập tài khoản' })
  @Roles(Role.SUPER_ADMIN)
  @Post(':id/revoke-invitation')
  revokeInvitation(@Param('id') id: string, @CurrentUser() actor: Actor) {
    return this.usersService.revokeInvitation(id, actor.id);
  }

  @Roles(Role.SUPER_ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: Actor,
  ) {
    return this.usersService.update(id, dto, actor.id);
  }

  @Roles(Role.SUPER_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() actor: Actor) {
    return this.usersService.remove(id, actor.id);
  }
}
