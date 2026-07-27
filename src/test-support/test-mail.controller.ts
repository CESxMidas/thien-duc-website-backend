import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { ApiExcludeController } from '@nestjs/swagger';
import { MailOutboxService, OutboxEntry } from '../mail/mail-outbox.service';
import { TestOnlyGuard } from './test-only.guard';

class SetFailModeDto {
  @IsBoolean()
  enabled!: boolean;
}

/**
 * Endpoint đọc outbox email giả — CHỈ tồn tại trong E2E cục bộ. Controller này
 * chỉ được nạp khi TestSupportModule được nạp (NODE_ENV=test + MAIL_FAKE_TRANSPORT=1),
 * và mọi route còn qua TestOnlyGuard (localhost). Ẩn khỏi Swagger.
 *
 * Playwright chạy ngoài tiến trình backend nên cần một cách đọc email đã "gửi"
 * để trích link thiết lập/đặt lại. Trả cả `url` (kèm token) cho test tự trích —
 * test có trách nhiệm KHÔNG in token ra output (dùng helper redact).
 */
@ApiExcludeController()
@UseGuards(TestOnlyGuard)
@Controller('test/mail')
export class TestMailController {
  constructor(private readonly outbox: MailOutboxService) {}

  /** Danh sách email đã ghi (mới nhất trước); lọc theo `?to=` nếu có. */
  @Get('outbox')
  list(@Query('to') to?: string): { count: number; entries: OutboxEntry[] } {
    const entries = this.outbox.list(to);
    return { count: entries.length, entries };
  }

  /** Xóa sạch outbox — gọi giữa các test để cô lập trạng thái. */
  @Delete('outbox')
  @HttpCode(204)
  clear(): void {
    this.outbox.clear();
  }

  /** Bật/tắt giả lập lỗi provider cho email liên hệ (§10 mục 9). */
  @Post('fail-mode')
  @HttpCode(200)
  setFailMode(@Body() dto: SetFailModeDto): { failMode: boolean } {
    this.outbox.setFailMode(dto.enabled);
    return { failMode: this.outbox.isFailMode() };
  }
}
