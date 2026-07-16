// PHẢI đứng đầu tiên — Sentry cần init trước khi mọi module khác được nạp.
import './instrument';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.use(helmet());

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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Thiên Đức API')
    .setDescription(
      'Đặc tả API backend website Thiên Đức (auth, projects, news, pages, banners, contact, media)',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('PORT') ?? 3001;
  // Bind 0.0.0.0 để Render/host container định tuyến được (mặc định chỉ localhost trong 1 số môi trường).
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
