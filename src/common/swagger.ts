import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Đường dẫn UI Swagger (đã có global prefix `api`). JSON nằm ở `<path>-json`. */
export const SWAGGER_PATH = 'api/docs';

/**
 * Swagger CHỈ được bật ngoài production.
 *
 * Tài liệu OpenAPI liệt kê TOÀN BỘ bề mặt API — gồm cả route quản trị
 * (`/api/users`, `/api/news/admin`, ...) và schema DTO. Authorization vẫn chặn dữ
 * liệu thật, nhưng công khai bản đồ API là mở rộng bề mặt tấn công không cần
 * thiết (khảo sát endpoint, dò tên field, sinh payload). Cách rẻ và ít rủi ro
 * nhất là KHÔNG khởi tạo Swagger ở production — không cần credential, không có
 * route nào để tấn công.
 *
 * FAIL-CLOSED: theo đúng quy ước đã ghi trong `.env.example`
 * (`process.env.NODE_ENV ?? 'production'`, cùng khuôn với `app.module.ts`,
 * `mail.service.ts`, `instrument.ts`), thiếu NODE_ENV thì coi như production.
 * Chuỗi rỗng/khoảng trắng cũng vậy — biến môi trường đặt hụt không được phép
 * vô tình bật lại tài liệu ở production. Chỉ giá trị khác `production` một cách
 * tường minh (`development`, `test`) mới bật Swagger.
 */
export function isSwaggerEnabled(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return (nodeEnv?.trim() || 'production') !== 'production';
}

/**
 * Khởi tạo Swagger nếu môi trường cho phép. Trả về `true` khi đã gắn tài liệu,
 * `false` khi bỏ qua (production).
 *
 * Tách thành hàm riêng để kiểm thử được mà không phải chạy `bootstrap()` thật —
 * cùng cách `configureTrustProxy` trong `trust-proxy.ts`.
 */
export function setupSwagger(
  app: INestApplication,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  if (!isSwaggerEnabled(nodeEnv)) {
    return false;
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Thiên Đức API')
    .setDescription(
      'Đặc tả API backend website Thiên Đức (auth, projects, news, pages, banners, contact, media)',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(SWAGGER_PATH, app, document);
  return true;
}
