import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Response } from 'express';

/**
 * Thông điệp an toàn (không lộ chi tiết nội bộ) cho các mã 4xx phát sinh ở tầng
 * middleware. Mã không có trong bảng dùng câu chung ở nơi gọi.
 */
const MIDDLEWARE_MESSAGES: Record<number, string> = {
  [HttpStatus.PAYLOAD_TOO_LARGE]:
    'Nội dung gửi lên vượt quá dung lượng cho phép.',
  [HttpStatus.BAD_REQUEST]: 'Yêu cầu không hợp lệ.',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'Kiểu nội dung không được hỗ trợ.',
};

/**
 * Lỗi tầng middleware (body-parser của Express) KHÔNG phải `HttpException` nhưng
 * vẫn mang sẵn mã HTTP ở `status`/`statusCode` — ví dụ vượt trần body JSON
 * (`entity.too.large` → 413, xem `common/body-limit.ts`). Nếu bỏ qua, chúng rơi
 * vào nhánh 500 "Internal server error": client không phân biệt được "payload
 * của bạn quá lớn" với "server hỏng", và mỗi lần như vậy còn bắn nhiễu lên
 * Sentry dù đây là lỗi phía client.
 *
 * CHỈ nhận 4xx: lỗi 5xx thật phải giữ nguyên đường 500 + báo Sentry, nên một
 * exception ngẫu nhiên có thuộc tính `status = 500` không thể mượn đường này để
 * tắt cảnh báo.
 */
function clientErrorStatus(exception: unknown): number | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const raw = exception as { status?: unknown; statusCode?: unknown };
  const code = typeof raw.status === 'number' ? raw.status : raw.statusCode;
  if (typeof code !== 'number' || !Number.isInteger(code)) return null;
  return code >= 400 && code <= 499 ? code : null;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // Lỗi middleware mang mã 4xx (vd. 413 vượt trần body) — trả đúng mã đó với
    // thông điệp chuẩn, KHÔNG kèm chi tiết nội bộ và KHÔNG báo Sentry.
    if (!(exception instanceof HttpException)) {
      const middlewareStatus = clientErrorStatus(exception);
      if (middlewareStatus !== null) {
        response.status(middlewareStatus).json({
          success: false,
          error: {
            code: HttpStatus[middlewareStatus] ?? 'ERROR',
            message:
              MIDDLEWARE_MESSAGES[middlewareStatus] ?? 'Request rejected',
            details: null,
          },
        });
        return;
      }
    }

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttpException ? exception.getResponse() : null;

    const message =
      typeof body === 'string'
        ? body
        : ((body as { message?: string | string[] })?.message ??
          'Internal server error');
    const code =
      (body as { error?: string })?.error ?? HttpStatus[status] ?? 'ERROR';

    if (!isHttpException) {
      this.logger.error(
        exception instanceof Error ? exception.stack : exception,
      );
      // Task →5: chỉ lỗi 500 bất ngờ mới lên Sentry — HttpException (400/404/
      // 409/423/429…) là hành vi chủ đích, capture sẽ ngập noise. Chưa init
      // (thiếu DSN) thì lời gọi này là no-op an toàn.
      Sentry.captureException(exception);
    }

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        details: isHttpException ? body : null,
      },
    });
  }
}
