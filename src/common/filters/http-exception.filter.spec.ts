import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

/**
 * Hợp đồng envelope lỗi + ánh xạ mã HTTP của filter bắt-tất-cả.
 *
 * Điểm chính (hồi quy AUDIT-M1 D1): lỗi tầng middleware của Express
 * (body-parser) KHÔNG phải `HttpException` nhưng mang sẵn mã 4xx ở
 * `status`/`statusCode`. Trước bản sửa, vượt trần body JSON trả **500
 * "Internal server error"** thay vì **413** — trái với chính ý định ghi ở
 * `common/body-limit.ts` — và còn bắn nhiễu Sentry cho một lỗi phía client.
 */

interface Captured {
  status: number;
  body: {
    success: boolean;
    error: { code: string; message: unknown; details: unknown };
  };
}

/** Dựng `ArgumentsHost` tối thiểu, thu lại status + body mà filter ghi ra. */
function makeHost(): { host: ArgumentsHost; captured: () => Captured } {
  let status = 0;
  let body: Captured['body'] | null = null;
  // Khai báo kiểu tường minh (không dùng `this` ngầm) để `status().json()` vẫn
  // chain được mà eslint không phải suy ra `this: any`.
  interface FakeResponse {
    status: (code: number) => FakeResponse;
    json: (payload: Captured['body']) => FakeResponse;
  }
  const response: FakeResponse = {
    status: (code: number) => {
      status = code;
      return response;
    },
    json: (payload: Captured['body']) => {
      body = payload;
      return response;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return {
    host,
    captured: () => {
      if (!body) throw new Error('filter chưa ghi response nào');
      return { status, body };
    },
  };
}

/** Lỗi body-parser thật: có `status`, `statusCode`, `type`, không phải HttpException. */
function payloadTooLargeError(): Error {
  const err = new Error('request entity too large') as Error & {
    status: number;
    statusCode: number;
    type: string;
  };
  err.status = HttpStatus.PAYLOAD_TOO_LARGE;
  err.statusCode = HttpStatus.PAYLOAD_TOO_LARGE;
  err.type = 'entity.too.large';
  return err;
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    // Filter log lỗi 500 bằng Logger — im lặng để output test sạch.
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('lỗi middleware mang mã 4xx (body-parser)', () => {
    it('vượt trần body JSON → 413, KHÔNG phải 500', () => {
      const { host, captured } = makeHost();
      filter.catch(payloadTooLargeError(), host);

      const { status, body } = captured();
      expect(status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('413 không lộ chi tiết nội bộ / stack ra client', () => {
      const { host, captured } = makeHost();
      filter.catch(payloadTooLargeError(), host);

      const { body } = captured();
      expect(body.error.details).toBeNull();
      const dump = JSON.stringify(body);
      expect(dump).not.toContain('entity.too.large');
      expect(dump).not.toMatch(/\.ts|\.js|node_modules|at\s+Object/);
    });

    it('dùng statusCode khi không có status', () => {
      const err = new Error('unsupported') as Error & { statusCode: number };
      err.statusCode = HttpStatus.UNSUPPORTED_MEDIA_TYPE;

      const { host, captured } = makeHost();
      filter.catch(err, host);

      expect(captured().status).toBe(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    });

    it('KHÔNG mượn đường 4xx cho lỗi mang status 5xx — vẫn 500', () => {
      const err = new Error('lỗi hạ tầng') as Error & { status: number };
      err.status = 503;

      const { host, captured } = makeHost();
      filter.catch(err, host);

      const { status, body } = captured();
      expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.error.message).toBe('Internal server error');
    });

    it('bỏ qua `status` không phải số nguyên (không tin dữ liệu lạ)', () => {
      const err = new Error('lạ') as Error & { status: unknown };
      err.status = '413';

      const { host, captured } = makeHost();
      filter.catch(err, host);

      expect(captured().status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('HttpException giữ nguyên hành vi', () => {
    it('404 giữ mã + message', () => {
      const { host, captured } = makeHost();
      filter.catch(new NotFoundException('Không tìm thấy'), host);

      const { status, body } = captured();
      expect(status).toBe(HttpStatus.NOT_FOUND);
      expect(body.error.message).toBe('Không tìm thấy');
    });

    it('409 slug trùng giữ mã Conflict', () => {
      const { host, captured } = makeHost();
      filter.catch(new ConflictException('Slug đã tồn tại'), host);

      expect(captured().status).toBe(HttpStatus.CONFLICT);
    });

    it('400 ValidationPipe giữ danh sách lỗi trong details', () => {
      const { host, captured } = makeHost();
      filter.catch(
        new BadRequestException(['title should not be null or undefined']),
        host,
      );

      const { status, body } = captured();
      expect(status).toBe(HttpStatus.BAD_REQUEST);
      expect(JSON.stringify(body.error.details)).toContain('title');
    });
  });

  describe('lỗi không xác định', () => {
    it('trả 500 với message chung, details null, KHÔNG lộ stack', () => {
      const { host, captured } = makeHost();
      filter.catch(new Error('bí mật nội bộ: DATABASE_URL=...'), host);

      const { status, body } = captured();
      expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.error.message).toBe('Internal server error');
      expect(body.error.details).toBeNull();
      expect(JSON.stringify(body)).not.toContain('DATABASE_URL');
    });
  });
});
