import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { json } from '../common/prisma-json';
import {
  EMPTY_DISPLAY_WINDOW,
  assertDisplayWindow,
  bannerPubliclyVisibleWhere,
  mergeDisplayWindow,
} from './display-window';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

@Injectable()
export class BannersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `activeOnly = true` là truy vấn CÔNG KHAI: lọc theo cả công tắc `isActive`
   * lẫn cửa sổ hiển thị, đánh giá ngay tại thời điểm truy vấn. Không có cron nào
   * tham gia — banner tới giờ thì request kế tiếp đã thấy, banner hết giờ thì
   * request kế tiếp đã mất, kể cả khi tiến trình vừa ngủ dậy.
   *
   * `activeOnly = false` là danh sách Admin: trả TẤT CẢ, kể cả banner đang tắt,
   * chưa tới hạn hay đã hết hạn — Admin phải sửa và sắp xếp được chúng.
   *
   * `now` nhận từ lời gọi (mặc định là hiện tại) để test chốt được đúng hành vi
   * tại BIÊN, thứ không thể dựng nếu hàm tự gọi `new Date()` bên trong.
   */
  findAll(activeOnly = false, now: Date = new Date()) {
    return this.prisma.banner.findMany({
      // `order` có thể trùng nhau (mặc định 0) nên chốt thêm createdAt để thứ tự
      // hiển thị ổn định giữa các lần gọi, tránh banner nhảy chỗ trên trang chủ.
      // Cửa sổ hiển thị chỉ LOẠI BỎ hàng, không đụng tới `order`: banner còn lại
      // giữ nguyên thứ tự tương đối như trước Batch 12.
      where: activeOnly ? bannerPubliclyVisibleWhere(now) : undefined,
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(id: string) {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Không tìm thấy banner');
    return banner;
  }

  // `async` dù thân hàm không `await`: phép kiểm cửa sổ ném đồng bộ, và một
  // method đồng bộ sẽ ném RA NGOÀI promise thay vì reject nó — khiến lời gọi
  // dùng `.catch()` bỏ lọt lỗi. `update()` cũng đã async, giữ hai luồng giống
  // nhau để không ai phải nhớ ngoại lệ này.
  async create(dto: CreateBannerDto) {
    // Bản ghi mới chưa có gì đang lưu nên "trộn" ở đây chỉ là chuyển đổi kiểu —
    // nhưng đi qua đúng một đường với update thì luật không thể lệch giữa hai
    // luồng, và không phải chép lại phép kiểm ở hai chỗ.
    const window = mergeDisplayWindow(EMPTY_DISPLAY_WINDOW, dto);
    assertDisplayWindow(window);

    return this.prisma.banner.create({
      data: {
        ...dto,
        title: json(dto.title),
        eyebrow: json(dto.eyebrow),
        subtitle: json(dto.subtitle),
        ctaLabel: json(dto.ctaLabel),
        ...window,
      } satisfies Prisma.BannerCreateInput,
    });
  }

  async update(id: string, dto: UpdateBannerDto) {
    const current = await this.findOne(id);

    // Kiểm trên TRẠNG THÁI SAU KHI GHI, không phải trên phần gửi lên: PATCH chỉ
    // đổi `displayFrom` vẫn có thể tạo ra cửa sổ đảo ngược khi ghép với
    // `displayUntil` đang lưu.
    const window = mergeDisplayWindow(current, dto);
    assertDisplayWindow(window);

    return this.prisma.banner.update({
      where: { id },
      data: {
        ...dto,
        title: json(dto.title),
        eyebrow: json(dto.eyebrow),
        subtitle: json(dto.subtitle),
        ctaLabel: json(dto.ctaLabel),
        // Ghi đè phần trải từ `dto` (vốn là chuỗi ISO) bằng `Date` đã trộn.
        // Trộn xong mà ghi lại nguyên vẹn cũng an toàn: giá trị bằng đúng cái
        // đang lưu thì câu UPDATE không đổi gì.
        ...window,
      } satisfies Prisma.BannerUpdateInput,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.banner.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Nhận toàn bộ id banner theo thứ tự mong muốn và ghi lại `order` (ED-06).
   * Bắt buộc gửi đủ danh sách: gửi thiếu sẽ để lại banner mang `order` cũ, xen
   * lẫn vào giữa dãy mới và làm thứ tự hiển thị sai.
   *
   * Cửa sổ hiển thị KHÔNG khoá banner lại: banner chưa tới hạn hoặc đã hết hạn
   * vẫn nằm trong danh sách Admin và vẫn sắp xếp được — thứ tự vừa đặt sẽ có
   * hiệu lực khi banner bước vào cửa sổ của nó. Đây là khác biệt có chủ ý so với
   * luồng duyệt/đăng của nội dung, nơi trạng thái xuất bản mới chi phối thao tác.
   */
  async reorder(bannerIds: string[]) {
    const total = await this.prisma.banner.count();
    const unique = new Set(bannerIds);

    if (unique.size !== bannerIds.length) {
      throw new BadRequestException('Danh sách id banner bị trùng lặp');
    }
    if (bannerIds.length !== total) {
      throw new BadRequestException(
        `Phải gửi đủ ${total} banner, hiện nhận ${bannerIds.length}`,
      );
    }

    const found = await this.prisma.banner.count({
      where: { id: { in: bannerIds } },
    });
    if (found !== bannerIds.length) {
      throw new BadRequestException('Có id banner không tồn tại');
    }

    await this.prisma.$transaction(
      bannerIds.map((id, index) =>
        this.prisma.banner.update({ where: { id }, data: { order: index } }),
      ),
    );
    return this.findAll();
  }
}
