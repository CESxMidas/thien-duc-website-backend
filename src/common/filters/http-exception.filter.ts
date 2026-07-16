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

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

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
