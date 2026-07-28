import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateBannerDto } from './dto/create-banner.dto';

/**
 * THIEN-DUC-BANNER-CONTENT-IMPLEMENTATION-M1 — khóa hợp đồng cho nội dung banner
 * trang chủ (`prisma/banner-content.json`, do `prisma/seed-banners.js` nạp).
 *
 * Test đọc thẳng file JSON và cho đi qua **đúng** `CreateBannerDto` mà controller
 * dùng, nên nội dung sai shape/quá dài sẽ chặn ở CI thay vì chỉ phát hiện khi
 * chạy seed lên DB. Không cần DB, không gọi mạng.
 */

const CONTENT_PATH = join(__dirname, '../../prisma/banner-content.json');

interface BannerSeedEntry {
  image: string;
  objectPosition?: string;
  eyebrow?: { vi: string; en?: string };
  title: { vi: string; en?: string };
  subtitle?: { vi: string; en?: string };
  ctaLabel?: { vi: string; en?: string };
  href: string;
  order: number;
  isActive: boolean;
}

const banners: BannerSeedEntry[] = JSON.parse(
  readFileSync(CONTENT_PATH, 'utf8'),
) as BannerSeedEntry[];

/**
 * Route công khai có thật trên frontend (`src/app/[locale]/…`). Banner trỏ ra
 * ngoài danh sách này = link chết trên trang chủ, nên chặn ngay ở test.
 * `/du-an/:slug` và `/du-an/:slug/:hang-muc` là route động — slug phải khớp dữ
 * liệu seed dự án (`prisma/seed-projects.js`), đối chiếu bên dưới.
 */
const STATIC_ROUTES = [
  '/',
  '/gioi-thieu',
  '/du-an',
  '/tin-tuc',
  '/cong-ty-thanh-vien',
  '/tuyen-dung',
  '/lien-he',
  '/dao-tao',
  '/chinh-sach-nhan-su',
  '/so-do-to-chuc-cong-ty',
];

/** Slug dự án + hạng mục lấy từ chính seed dự án (nguồn sự thật của route động). */
function seededProjectPaths(): Set<string> {
  const source = readFileSync(
    join(__dirname, '../../prisma/seed-projects.js'),
    'utf8',
  );
  const paths = new Set<string>();
  // Seed khai báo `slug: '…'`; slug dự án đứng trước, slug hạng mục nằm trong
  // mảng `items` của dự án ngay trên nó — bám đúng thứ tự xuất hiện trong file.
  let currentProject = '';
  for (const [, slug] of source.matchAll(/slug:\s*'([a-z0-9-]+)'/g)) {
    const isProjectLevel = /^(khu-do-thi|chung-cu|du-an)-/.test(slug);
    if (isProjectLevel) {
      currentProject = slug;
      paths.add(`/du-an/${slug}`);
    } else if (currentProject) {
      paths.add(`/du-an/${currentProject}/${slug}`);
    }
  }
  return paths;
}

describe('Nội dung banner trang chủ (prisma/banner-content.json)', () => {
  it('có đủ 4 banner cho 4 ảnh banner đang có, không trùng ảnh', () => {
    expect(banners).toHaveLength(4);
    const images = banners.map((b) => b.image);
    expect(new Set(images).size).toBe(images.length);
  });

  it('mọi banner đi qua CreateBannerDto không lỗi validate', () => {
    for (const banner of banners) {
      const dto = plainToInstance(CreateBannerDto, banner);
      const errors = validateSync(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      const detail = errors
        .map(
          (e) =>
            `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
        )
        .join(' | ');
      expect(errors.map((e) => e.property)).toEqual([]);
      expect(detail).toBe('');
    }
  });

  it('ảnh trỏ vào thư mục banner tĩnh đã có sẵn (không upload mới)', () => {
    for (const banner of banners) {
      expect(banner.image).toMatch(
        /^\/images\/banners\/home\/[a-z0-9-]+\.jpg$/,
      );
    }
  });

  it('song ngữ đầy đủ: mọi field chữ đều có cả vi lẫn en', () => {
    for (const banner of banners) {
      for (const field of [
        'eyebrow',
        'title',
        'subtitle',
        'ctaLabel',
      ] as const) {
        const value = banner[field];
        // Gộp ảnh + tên field vào giá trị so sánh: jest `expect` không nhận
        // tham số message, nên báo lỗi phải tự mang ngữ cảnh.
        expect(`${banner.image} ${field}: ${value ? 'có' : 'THIẾU'}`).toBe(
          `${banner.image} ${field}: có`,
        );
        expect(value!.vi.trim().length).toBeGreaterThan(0);
        expect(value!.en?.trim().length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  /**
   * Trần độ dài **đo từ chính khung hero**, không phải con số tuỳ chọn:
   *  • tiêu đề `line-clamp-2`, tới `3.25rem` ở desktop trong hộp `max-w-2xl`
   *    → quá ~45 ký tự là tràn sang dòng thứ 3 và bị cắt mất chữ;
   *  • mô tả `line-clamp-3`, `text-sm` ở mobile 375px → quá ~125 ký tự bị cắt.
   * Kiểm lại bằng E2E responsive (`admin/e2e/public/banner-content.e2e.ts`).
   */
  it('độ dài vừa khung hero (tiêu đề ≤ 45, mô tả ≤ 125, nhãn nút ≤ 30)', () => {
    for (const banner of banners) {
      for (const text of [banner.title.vi, banner.title.en!]) {
        expect(text.length).toBeGreaterThanOrEqual(25);
        expect(text.length).toBeLessThanOrEqual(45);
      }
      for (const text of [banner.subtitle!.vi, banner.subtitle!.en!]) {
        expect(text.length).toBeGreaterThanOrEqual(80);
        expect(text.length).toBeLessThanOrEqual(125);
      }
      for (const text of [banner.ctaLabel!.vi, banner.ctaLabel!.en!]) {
        expect(text.length).toBeLessThanOrEqual(30);
      }
    }
  });

  it('href trỏ tới route công khai có thật (tĩnh hoặc slug đã seed)', () => {
    const dynamic = seededProjectPaths();
    // Chốt regex đọc seed vẫn bắt được slug — tránh test xanh giả khi seed đổi.
    expect(dynamic.has('/du-an/khu-do-thi-hung-phu')).toBe(true);
    expect(dynamic.has('/du-an/khu-do-thi-hung-phu/fancy-tower')).toBe(true);

    for (const banner of banners) {
      expect(banner.href.startsWith('/')).toBe(true);
      // Không nhúng tiền tố locale: frontend tự thêm `/en` qua localizePath.
      expect(banner.href.startsWith('/en/')).toBe(false);
      const known =
        STATIC_ROUTES.includes(banner.href) || dynamic.has(banner.href);
      // So sánh trên chính chuỗi href để thông báo lỗi chỉ đúng banner sai.
      expect(known ? banner.href : `route không tồn tại: ${banner.href}`).toBe(
        banner.href,
      );
    }
  });

  it('objectPosition là giá trị CSS hợp lệ và ngắn (≤ 60 ký tự)', () => {
    for (const banner of banners) {
      expect(banner.objectPosition).toBeDefined();
      expect(banner.objectPosition!.length).toBeLessThanOrEqual(60);
      expect(banner.objectPosition).toMatch(
        /^(center|left|right|\d{1,3}%) (center|top|bottom|\d{1,3}%)$/,
      );
    }
  });

  it('thứ tự tất định 0..n-1 và mọi banner đều bật', () => {
    expect(banners.map((b) => b.order)).toEqual([0, 1, 2, 3]);
    expect(banners.every((b) => b.isActive)).toBe(true);
  });
});
