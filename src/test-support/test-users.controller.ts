import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { TestOnlyGuard } from './test-only.guard';
import {
  TestUsersService,
  TestUserView,
  TestUserDiagnostics,
} from './test-users.service';
import { UpsertTestUserDto } from './dto/upsert-test-user.dto';

/**
 * Endpoint FIXTURE tài khoản E2E — CHỈ tồn tại trong E2E cục bộ (module chỉ nạp
 * khi NODE_ENV=test + MAIL_FAKE_TRANSPORT=1), mọi route còn qua TestOnlyGuard
 * (localhost). Dùng để dựng tài khoản pending/inactive/active trong domain
 * @e2e.test mà không cần cài driver DB vào repo Admin. Ẩn khỏi Swagger.
 */
@ApiExcludeController()
@UseGuards(TestOnlyGuard)
@Controller('test/users')
export class TestUsersController {
  constructor(private readonly service: TestUsersService) {}

  /** Tạo/ghi đè một tài khoản fixture. */
  @Post()
  @HttpCode(201)
  upsert(@Body() dto: UpsertTestUserDto): Promise<TestUserView> {
    return this.service.upsert(dto);
  }

  /** Chẩn đoán một tài khoản (bất kỳ email) — null nếu không có. */
  @Get(':email')
  get(@Param('email') email: string): Promise<TestUserDiagnostics | null> {
    return this.service.getByEmail(email);
  }

  /** Làm già lời mời đang mở của tài khoản fixture (vượt cooldown gửi-lại). */
  @Post(':email/age-invitations')
  @HttpCode(200)
  async ageInvitations(
    @Param('email') email: string,
  ): Promise<{ count: number }> {
    return { count: await this.service.ageInvitations(email) };
  }

  /** Xoá mọi tài khoản fixture @e2e.test. */
  @Delete()
  @HttpCode(200)
  async clear(): Promise<{ count: number }> {
    return { count: await this.service.deleteAll() };
  }
}
