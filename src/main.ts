// PHẢI đứng đầu tiên — Sentry cần init trước khi mọi module khác được nạp.
import './instrument';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { JSON_BODY_LIMIT } from './common/body-limit';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { setupSwagger } from './common/swagger';
import { configureTrustProxy } from './common/trust-proxy';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  // Sau reverse proxy của Render, `req.ip` phải lấy từ X-Forwarded-For thì
  // rate-limit (throttler) và IP lưu kèm lead mới đúng IP client. Xem trust-proxy.ts.
  configureTrustProxy(app);

  app.use(helmet());

  // Nới trần body JSON khỏi mặc định 100 kb của Express — xem `body-limit.ts`.
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: JSON_BODY_LIMIT, extended: true });

  // CORS_ORIGIN bắt buộc — không fallback thành wildcard để tránh vô tình mở công khai
  const corsOrigin = configService.get<string>('CORS_ORIGIN');
  if (!corsOrigin) {
    throw new Error(
      'CORS_ORIGIN environment variable is required. Provide comma-separated allowed origins (no spaces).',
    );
  }

  app.enableCors({
    origin: corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // Ngoài production: /api/docs + /api/docs-json. Ở production KHÔNG khởi tạo —
  // xem `common/swagger.ts` (fail-closed: thiếu NODE_ENV cũng coi là production).
  setupSwagger(app);

  const port = configService.get<number>('PORT') ?? 3001;
  // Bind 0.0.0.0 để Render/host container định tuyến được (mặc định chỉ localhost trong 1 số môi trường).
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
