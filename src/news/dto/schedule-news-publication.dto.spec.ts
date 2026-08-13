import { ValidationPipe } from '@nestjs/common';
import { ScheduleNewsPublicationDto } from './schedule-news-publication.dto';

/**
 * Hợp đồng tầng validate của lệnh đặt lịch.
 *
 * Điểm quan trọng nhất: **từ chối chuỗi không có múi giờ.** `@IsDateString()`
 * (thứ dự án dùng cho `eventDate`) chấp nhận `2026-08-20T08:00`, và `new Date()`
 * sẽ diễn giải nó theo múi giờ của tiến trình. Backend chạy UTC trên Render còn
 * máy biên tập viên chạy UTC+7 — cùng một payload cho ra hai thời điểm lệch 7
 * tiếng mà không bên nào báo lỗi. Với field quyết định *khi nào nội dung ra công
 * khai*, đó là kiểu sai âm thầm tệ nhất.
 *
 * Chạy ValidationPipe THẬT với đúng cấu hình ở `main.ts`.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const metatype = ScheduleNewsPublicationDto;

async function validate(body: unknown): Promise<unknown> {
  return (await pipe.transform(body, { type: 'body', metatype })) as unknown;
}

describe('ScheduleNewsPublicationDto', () => {
  describe('chấp nhận mốc có múi giờ tường minh', () => {
    it.each([
      ['offset giờ VN', '2026-08-20T08:00:00+07:00'],
      ['Zulu', '2026-08-20T01:00:00Z'],
      ['offset âm', '2026-08-19T18:00:00-07:00'],
      ['có mili giây', '2026-08-20T01:00:00.500Z'],
      ['không có giây', '2026-08-20T01:00Z'],
    ])('%s', async (_label, scheduledAt) => {
      await expect(validate({ scheduledAt })).resolves.toMatchObject({
        scheduledAt,
      });
    });
  });

  describe('từ chối mốc mơ hồ hoặc sai định dạng', () => {
    it.each([
      ['thiếu múi giờ', '2026-08-20T08:00'],
      ['thiếu múi giờ, có giây', '2026-08-20T08:00:00'],
      ['định dạng SQL (dấu cách thay T)', '2026-08-20 08:00:00+07:00'],
      ['chỉ có ngày', '2026-08-20'],
      ['rác', 'khong-phai-ngay'],
      ['chuỗi rỗng', ''],
      ['ngày không tồn tại', '2026-02-31T08:00:00+07:00'],
      ['giờ 25', '2026-08-20T25:00:00+07:00'],
    ])('%s → 400', async (_label, scheduledAt) => {
      await expect(validate({ scheduledAt })).rejects.toMatchObject({
        status: 400,
      });
    });

    it('thiếu hẳn field → 400', async () => {
      await expect(validate({})).rejects.toMatchObject({ status: 400 });
    });

    it('kiểu sai (number) → 400', async () => {
      await expect(
        validate({ scheduledAt: 1_755_657_600 }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('field lạ đi kèm → 400 (whitelist), không âm thầm bỏ qua', async () => {
      await expect(
        validate({ scheduledAt: '2026-08-20T01:00:00Z', status: 'PUBLISHED' }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  it('thông báo lỗi chỉ rõ field và nêu ví dụ đúng', async () => {
    expect.assertions(2);
    try {
      await validate({ scheduledAt: '2026-08-20T08:00' });
    } catch (error) {
      const body = (
        error as { getResponse(): { message: string[] } }
      ).getResponse();
      const message = body.message.join(' ');
      expect(message).toContain('scheduledAt');
      expect(message).toContain('+07:00');
    }
  });
});
