import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { TestOnlyGuard } from './test-only.guard';

/** Domain email dành riêng cho lead E2E — cleanup chỉ đụng đúng các bản ghi này. */
const E2E_EMAIL_DOMAIN = '@e2e.test';

/**
 * Endpoint kiểm tra/ dọn lead liên hệ do E2E tạo — CHỈ tồn tại trong E2E cục bộ
 * (module gate + TestOnlyGuard). Xoá chỉ nhắm email @e2e.test để không đụng lead
 * thật. Ẩn khỏi Swagger.
 */
@ApiExcludeController()
@UseGuards(TestOnlyGuard)
@Controller('test/contact')
export class TestContactController {
  constructor(private readonly prisma: PrismaService) {}

  /** Danh sách lead theo email (dùng xác minh đã lưu DB + nội dung). */
  @Get()
  list(@Query('email') email?: string) {
    return this.prisma.contactSubmission.findMany({
      where: email ? { email } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Xoá mọi lead E2E (email @e2e.test). Trả số bản ghi đã xoá. */
  @Delete()
  @HttpCode(200)
  async clear(): Promise<{ count: number }> {
    const res = await this.prisma.contactSubmission.deleteMany({
      where: { email: { endsWith: E2E_EMAIL_DOMAIN } },
    });
    return { count: res.count };
  }
}
