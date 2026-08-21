import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { BannersService } from './banners.service';
import type { Prisma } from '../../generated/prisma/client';
import type { CreateBannerDto } from './dto/create-banner.dto';

/**
 * BANNER — CỬA SỔ HIỂN THỊ (Batch 12) ở tầng service.
 *
 * Hai nhóm câu hỏi:
 *  1. GHI: cửa sổ nào được nhận, cửa sổ nào bị từ chối, và PATCH có soi lại giá
 *     trị ĐANG LƯU trước khi chấp nhận không.
 *  2. ĐỌC: truy vấn công khai gửi xuống Prisma đúng vị từ nào — kiểm bằng chính
 *     `where` mà service dựng, còn hành vi trên DB THẬT thì
 *     `test/banner-display-window.e2e-spec.ts` lo.
 *
 * Prisma bị stub, nên `findMany` trả lại cái gì không quan trọng; thứ được khoá
 * ở đây là ĐỐI SỐ service truyền xuống.
 */

const bilingual = (vi: string) => ({ vi, en: vi });

const baseDto: CreateBannerDto = {
  image: '/images/banners/home/a.jpg',
  title: bilingual('Banner'),
  href: '/du-an',
};

const NOW = new Date('2026-09-15T00:00:00.000Z');

/** Cửa sổ đang lưu của bản ghi mà `findUnique` trả về trong nhóm PATCH. */
const STORED = {
  displayFrom: new Date('2026-09-10T00:00:00.000Z'),
  displayUntil: new Date('2026-09-20T00:00:00.000Z'),
};

describe('BannersService — cửa sổ hiển thị', () => {
  let service: BannersService;
  let prisma: {
    banner: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      banner: {
        create: jest.fn().mockResolvedValue({ id: 'b1' }),
        update: jest.fn().mockResolvedValue({ id: 'b1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'b1', ...STORED }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        delete: jest.fn().mockResolvedValue({ id: 'b1' }),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [BannersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(BannersService);
  });

  /**
   * Dữ liệu thực sự gửi xuống `prisma.banner.create/update`.
   *
   * `jest.Mock` không mang kiểu đối số nên phải khẳng định — nhưng khẳng định
   * MỘT lần ở đây, thay vì rải `as any` khắp các assertion bên dưới.
   */
  const writtenData = (call: jest.Mock): Record<string, unknown> =>
    (call.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;

  /** Đối số của lần gọi `findMany` đầu tiên, đã gắn kiểu Prisma. */
  const findManyArgs = (): Prisma.BannerFindManyArgs =>
    (prisma.banner.findMany.mock.calls[0] as [Prisma.BannerFindManyArgs])[0];

  describe('CREATE', () => {
    it('không gửi cửa sổ: ghi xuống hai NULL (banner luôn hiển thị)', async () => {
      await service.create({ ...baseDto });
      expect(writtenData(prisma.banner.create)).toMatchObject({
        displayFrom: null,
        displayUntil: null,
      });
    });

    it('chỉ displayFrom: hợp lệ, biên trên vẫn NULL', async () => {
      await service.create({
        ...baseDto,
        displayFrom: '2026-09-01T08:00:00+07:00',
      });
      const data = writtenData(prisma.banner.create);
      expect(data.displayFrom).toEqual(new Date('2026-09-01T01:00:00.000Z'));
      expect(data.displayUntil).toBeNull();
    });

    it('chỉ displayUntil: hợp lệ, biên dưới vẫn NULL', async () => {
      await service.create({
        ...baseDto,
        displayUntil: '2026-12-31T17:00:00.000Z',
      });
      const data = writtenData(prisma.banner.create);
      expect(data.displayFrom).toBeNull();
      expect(data.displayUntil).toEqual(new Date('2026-12-31T17:00:00.000Z'));
    });

    it('from < until: hợp lệ, ghi cả hai mốc dưới dạng Date', async () => {
      await service.create({
        ...baseDto,
        displayFrom: '2026-09-10T00:00:00.000Z',
        displayUntil: '2026-09-20T00:00:00.000Z',
      });
      const data = writtenData(prisma.banner.create);
      expect(data.displayFrom).toBeInstanceOf(Date);
      expect(data.displayUntil).toBeInstanceOf(Date);
    });

    it.each([
      ['from == until', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'],
      ['from > until', '2026-09-20T00:00:00.000Z', '2026-09-10T00:00:00.000Z'],
    ])('%s: từ chối 400 và KHÔNG ghi gì', async (_label, from, until) => {
      await expect(
        service.create({
          ...baseDto,
          displayFrom: from,
          displayUntil: until,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.banner.create).not.toHaveBeenCalled();
    });

    it('cửa sổ bắt đầu ngay và chỉ dài 1 phút: được chấp nhận', async () => {
      const now = new Date();
      await service.create({
        ...baseDto,
        displayFrom: now.toISOString(),
        displayUntil: new Date(now.getTime() + 60_000).toISOString(),
      });
      expect(prisma.banner.create).toHaveBeenCalled();
    });
  });

  describe('UPDATE — kiểm trên TRẠNG THÁI SAU KHI GHI', () => {
    it('chỉ đổi displayFrom, kết quả trộn hợp lệ: cho qua', async () => {
      await service.update('b1', { displayFrom: '2026-09-12T00:00:00.000Z' });
      const data = writtenData(prisma.banner.update);
      expect(data.displayFrom).toEqual(new Date('2026-09-12T00:00:00.000Z'));
      // Biên trên đang lưu được giữ nguyên, không bị PATCH làm mất.
      expect(data.displayUntil).toEqual(STORED.displayUntil);
    });

    /** Ca mẫu của §18. */
    it('chỉ đổi displayFrom nhưng vượt qua displayUntil đang lưu: 400', async () => {
      await expect(
        service.update('b1', { displayFrom: '2026-09-25T00:00:00.000Z' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.banner.update).not.toHaveBeenCalled();
    });

    it('chỉ đổi displayUntil về trước displayFrom đang lưu: 400', async () => {
      await expect(
        service.update('b1', { displayUntil: '2026-09-05T00:00:00.000Z' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.banner.update).not.toHaveBeenCalled();
    });

    it('PATCH không đụng tới cửa sổ: hai mốc đang lưu được ghi lại nguyên vẹn', async () => {
      await service.update('b1', { href: '/lien-he' });
      const data = writtenData(prisma.banner.update);
      expect(data.displayFrom).toEqual(STORED.displayFrom);
      expect(data.displayUntil).toEqual(STORED.displayUntil);
    });

    it('xoá displayFrom bằng null: banner có hiệu lực ngay, biên trên còn nguyên', async () => {
      await service.update('b1', { displayFrom: null });
      const data = writtenData(prisma.banner.update);
      expect(data.displayFrom).toBeNull();
      expect(data.displayUntil).toEqual(STORED.displayUntil);
    });

    it('xoá displayUntil bằng null: banner không còn hết hạn', async () => {
      await service.update('b1', { displayUntil: null });
      const data = writtenData(prisma.banner.update);
      expect(data.displayFrom).toEqual(STORED.displayFrom);
      expect(data.displayUntil).toBeNull();
    });

    it('xoá cả hai: quay về đúng hành vi trước Batch 12', async () => {
      await service.update('b1', { displayFrom: null, displayUntil: null });
      expect(writtenData(prisma.banner.update)).toMatchObject({
        displayFrom: null,
        displayUntil: null,
      });
    });

    it('xoá biên gây xung đột trong CÙNG một PATCH: cho qua', async () => {
      await service.update('b1', {
        displayFrom: '2026-09-25T00:00:00.000Z',
        displayUntil: null,
      });
      const data = writtenData(prisma.banner.update);
      expect(data.displayFrom).toEqual(new Date('2026-09-25T00:00:00.000Z'));
      expect(data.displayUntil).toBeNull();
    });

    it('không ghi scheduledAt/publishedAt — banner không có vòng đời xuất bản', async () => {
      await service.update('b1', { displayFrom: '2026-09-12T00:00:00.000Z' });
      const data = writtenData(prisma.banner.update);
      expect(data).not.toHaveProperty('scheduledAt');
      expect(data).not.toHaveProperty('publishedAt');
      expect(data).not.toHaveProperty('status');
    });
  });

  describe('ĐỌC — vị từ truy vấn', () => {
    it('công khai: lọc theo isActive VÀ cửa sổ, tại đúng `now` được truyền', async () => {
      await service.findAll(true, NOW);
      expect(findManyArgs().where).toEqual({
        isActive: true,
        AND: [
          { OR: [{ displayFrom: null }, { displayFrom: { lte: NOW } }] },
          { OR: [{ displayUntil: null }, { displayUntil: { gt: NOW } }] },
        ],
      });
    });

    it('công khai: giữ nguyên thứ tự order → createdAt như trước Batch 12', async () => {
      await service.findAll(true, NOW);
      expect(findManyArgs().orderBy).toEqual([
        { order: 'asc' },
        { createdAt: 'asc' },
      ]);
    });

    it('Admin: KHÔNG lọc gì cả — banner tắt, chưa tới hạn, hết hạn đều hiện', async () => {
      await service.findAll(false, NOW);
      expect(findManyArgs().where).toBeUndefined();
    });

    it('không truyền `now`: vẫn dựng vị từ, mốc lấy quanh thời điểm gọi', async () => {
      const before = Date.now();
      await service.findAll(true);
      const after = Date.now();
      const lower = (findManyArgs().where?.AND as Prisma.BannerWhereInput[])[0]
        .OR as Prisma.BannerWhereInput[];
      const used = (lower[1].displayFrom as { lte: Date }).lte;
      expect(used.getTime()).toBeGreaterThanOrEqual(before);
      expect(used.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('REORDER — cửa sổ hiển thị không khoá banner lại', () => {
    it('sắp xếp được cả banner chưa tới hạn / đã hết hạn (không lọc theo thời gian)', async () => {
      prisma.banner.count.mockResolvedValue(2);
      await service.reorder(['b1', 'b2']);

      // Không có phép đếm/lọc nào theo displayFrom/displayUntil trong luồng này.
      for (const call of prisma.banner.count.mock.calls as [unknown][]) {
        expect(JSON.stringify(call[0] ?? {})).not.toContain('display');
      }
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});
