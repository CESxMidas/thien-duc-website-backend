import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { SWAGGER_PATH, isSwaggerEnabled, setupSwagger } from './swagger';

/**
 * SEC — Swagger KHÔNG được khởi tạo ở production.
 *
 * Tài liệu OpenAPI công khai liệt kê toàn bộ bề mặt API (gồm route quản trị và
 * schema DTO). Đây là hồi quy chặn việc vô tình bật lại ở production, kể cả khi
 * NODE_ENV bị thiếu hoặc đặt hụt thành chuỗi rỗng (fail-closed).
 */
describe('Swagger production gating', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  let createDocument: jest.SpyInstance;
  let setup: jest.SpyInstance;
  /** Config truyền vào `createDocument` của lần gọi gần nhất (nếu có). */
  let capturedConfig: Omit<OpenAPIObject, 'paths'> | undefined;
  const app = {} as INestApplication;

  beforeEach(() => {
    capturedConfig = undefined;
    createDocument = jest
      .spyOn(SwaggerModule, 'createDocument')
      .mockImplementation((_app, config) => {
        capturedConfig = config;
        return {} as OpenAPIObject;
      });
    setup = jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // Không để rò NODE_ENV sang suite khác — các module khác (app.module,
    // mail.service, throttler guard) đều đọc biến này.
    if (ORIGINAL_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
  });

  describe('isSwaggerEnabled', () => {
    it('tắt ở production', () => {
      expect(isSwaggerEnabled('production')).toBe(false);
    });

    it('bật ở development và test', () => {
      expect(isSwaggerEnabled('development')).toBe(true);
      expect(isSwaggerEnabled('test')).toBe(true);
    });

    it('fail-closed: thiếu NODE_ENV coi như production', () => {
      // Không truyền tham số để đi qua đúng nhánh mặc định đọc process.env —
      // truyền `undefined` tường minh cũng rơi vào default parameter đó.
      delete process.env.NODE_ENV;
      expect(isSwaggerEnabled()).toBe(false);
    });

    it('fail-closed: NODE_ENV rỗng/khoảng trắng coi như production', () => {
      expect(isSwaggerEnabled('')).toBe(false);
      expect(isSwaggerEnabled('   ')).toBe(false);
    });

    it('đọc process.env.NODE_ENV khi không truyền tham số', () => {
      process.env.NODE_ENV = 'production';
      expect(isSwaggerEnabled()).toBe(false);

      process.env.NODE_ENV = 'development';
      expect(isSwaggerEnabled()).toBe(true);
    });
  });

  describe('setupSwagger', () => {
    it('KHÔNG khởi tạo Swagger khi NODE_ENV=production', () => {
      process.env.NODE_ENV = 'production';

      expect(setupSwagger(app)).toBe(false);
      expect(createDocument).not.toHaveBeenCalled();
      expect(setup).not.toHaveBeenCalled();
    });

    it('KHÔNG khởi tạo Swagger khi thiếu NODE_ENV', () => {
      delete process.env.NODE_ENV;

      expect(setupSwagger(app)).toBe(false);
      expect(createDocument).not.toHaveBeenCalled();
      expect(setup).not.toHaveBeenCalled();
    });

    it('vẫn khởi tạo Swagger ở development, giữ nguyên đường dẫn api/docs', () => {
      process.env.NODE_ENV = 'development';

      expect(setupSwagger(app)).toBe(true);
      expect(createDocument).toHaveBeenCalledTimes(1);
      expect(setup).toHaveBeenCalledWith('api/docs', app, expect.anything());
      expect(SWAGGER_PATH).toBe('api/docs');
    });

    it('vẫn khởi tạo Swagger ở test', () => {
      process.env.NODE_ENV = 'test';

      expect(setupSwagger(app)).toBe(true);
      expect(setup).toHaveBeenCalledTimes(1);
    });

    it('giữ nguyên tiêu đề/phiên bản tài liệu ngoài production', () => {
      expect(setupSwagger(app, 'development')).toBe(true);

      expect(capturedConfig?.info.title).toBe('Thiên Đức API');
      expect(capturedConfig?.info.version).toBe('0.1.0');
    });
  });
});
