import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { json } from '../common/prisma-json';
import {
  assertContentStatusTransition,
  initialContentStatus,
} from '../common/content-approval';
import { CreateGalleryImageDto } from './dto/create-gallery-image.dto';
import { CreateProjectItemDto } from './dto/create-project-item.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateGalleryImageDto } from './dto/update-gallery-image.dto';
import { UpdateProjectItemDto } from './dto/update-project-item.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

/** Mã lỗi Prisma khi vi phạm ràng buộc duy nhất (`slug` dự án, `[projectId, slug]` hạng mục). */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === PRISMA_UNIQUE_VIOLATION;
}

/** Ảnh và hạng mục luôn trả theo `order` tăng dần — thứ tự do biên tập viên đặt. */
const BY_ORDER = { order: 'asc' } as const;

/**
 * Các cột JSON tùy chọn: khi Admin muốn **xóa** nội dung (vd. bỏ bản đồ), payload
 * gửi `null`. Prisma không nhận `null` trực tiếp cho cột Json? — phải quy đổi sang
 * `Prisma.DbNull`. Bỏ qua `undefined` (không đụng tới field đó).
 */
const NULLABLE_JSON_FIELDS = [
  'description',
  'location',
  'category',
  'highlights',
  'quickFacts',
  'gallerySections',
  'mapLocation',
] as const;

function normalizeJsonNulls<T extends object>(dto: T): T {
  const out = { ...dto } as Record<string, unknown>;
  for (const field of NULLABLE_JSON_FIELDS) {
    if (out[field] === null) out[field] = Prisma.DbNull;
  }
  return out as T;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `publishedOnly` = true cho website công khai; false cho Admin CMS (thấy cả
   * bản nháp và bài chờ duyệt).
   */
  findAll(publishedOnly = false) {
    return this.prisma.project.findMany({
      where: publishedOnly
        ? { contentStatus: ContentStatus.PUBLISHED }
        : undefined,
      orderBy: { order: 'asc' },
      include: {
        items: { orderBy: BY_ORDER },
        _count: { select: { galleryImages: true } },
      },
    });
  }

  /**
   * `publishedOnly` bắt buộc bật ở route công khai — nếu không, dự án nháp và
   * dự án chờ duyệt đọc được từ bên ngoài chỉ bằng cách đoán slug (cùng lỗi đã
   * vá ở `news` và `pages`).
   */
  async findBySlug(slug: string, publishedOnly = false) {
    const project = await this.prisma.project.findUnique({
      where: { slug },
      include: {
        items: { orderBy: BY_ORDER },
        galleryImages: { orderBy: BY_ORDER },
      },
    });
    if (
      !project ||
      (publishedOnly && project.contentStatus !== ContentStatus.PUBLISHED)
    ) {
      throw new NotFoundException('Không tìm thấy dự án');
    }
    return project;
  }

  async findItemBySlug(
    projectSlug: string,
    itemSlug: string,
    publishedOnly = false,
  ) {
    const project = await this.findBySlug(projectSlug, publishedOnly);
    const item = await this.prisma.projectItem.findFirst({
      where: { projectId: project.id, slug: itemSlug },
      include: { galleryImages: { orderBy: BY_ORDER } },
    });
    if (!item) throw new NotFoundException('Không tìm thấy hạng mục dự án');
    return item;
  }

  async create(dto: CreateProjectDto, actorRole?: string) {
    try {
      return await this.prisma.project.create({
        data: {
          ...dto,
          title: json(dto.title),
          summary: json(dto.summary),
          description: json(dto.description),
          location: json(dto.location),
          category: json(dto.category),
          highlights: json(dto.highlights),
          quickFacts: json(dto.quickFacts),
          gallerySections: json(dto.gallerySections),
          mapLocation: json(dto.mapLocation),
          // SUPER_ADMIN bỏ qua luồng duyệt → dự án xuất bản ngay; vai trò khác nháp.
          contentStatus: initialContentStatus(actorRole),
        } satisfies Prisma.ProjectCreateInput,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`Slug "${dto.slug}" đã được dùng`);
      }
      throw error;
    }
  }

  async update(slug: string, dto: UpdateProjectDto) {
    const project = await this.findBySlug(slug);
    // Chuẩn hóa null → Prisma.DbNull TRƯỚC, rồi bọc chính giá trị đã chuẩn hóa
    // để giữ nguyên hành vi xóa field JSON (json() là identity lúc chạy).
    const data = normalizeJsonNulls(dto);
    try {
      return await this.prisma.project.update({
        where: { id: project.id },
        data: {
          ...data,
          title: json(data.title),
          summary: json(data.summary),
          description: json(data.description),
          location: json(data.location),
          category: json(data.category),
          highlights: json(data.highlights),
          quickFacts: json(data.quickFacts),
          gallerySections: json(data.gallerySections),
          mapLocation: json(data.mapLocation),
        } satisfies Prisma.ProjectUpdateInput,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`Slug "${dto.slug}" đã được dùng`);
      }
      throw error;
    }
  }

  async updateStatus(slug: string, status: ContentStatus, actorRole?: string) {
    const project = await this.findBySlug(slug);
    // EDITOR chỉ được gửi duyệt (DRAFT → PENDING); ADMIN trở lên đặt tùy ý.
    assertContentStatusTransition(actorRole, project.contentStatus, status);
    return this.prisma.project.update({
      where: { id: project.id },
      data: { contentStatus: status },
    });
  }

  async remove(slug: string) {
    const project = await this.findBySlug(slug);
    // Hạng mục và ảnh gallery xóa theo cascade (khai báo ở schema.prisma).
    await this.prisma.project.delete({ where: { id: project.id } });
    return { deleted: true };
  }

  /* ----------------------------- Hạng mục con ----------------------------- */

  async createItem(projectSlug: string, dto: CreateProjectItemDto) {
    const project = await this.findBySlug(projectSlug);
    try {
      return await this.prisma.projectItem.create({
        data: {
          ...dto,
          projectId: project.id,
          title: json(dto.title),
          summary: json(dto.summary),
          description: json(dto.description),
          highlights: json(dto.highlights),
          quickFacts: json(dto.quickFacts),
          gallerySections: json(dto.gallerySections),
        } satisfies Prisma.ProjectItemUncheckedCreateInput,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `Dự án này đã có hạng mục với slug "${dto.slug}"`,
        );
      }
      throw error;
    }
  }

  async updateItem(
    projectSlug: string,
    itemSlug: string,
    dto: UpdateProjectItemDto,
  ) {
    const item = await this.findItemBySlug(projectSlug, itemSlug);
    try {
      return await this.prisma.projectItem.update({
        where: { id: item.id },
        data: {
          ...dto,
          title: json(dto.title),
          summary: json(dto.summary),
          description: json(dto.description),
          highlights: json(dto.highlights),
          quickFacts: json(dto.quickFacts),
          gallerySections: json(dto.gallerySections),
        } satisfies Prisma.ProjectItemUpdateInput,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `Dự án này đã có hạng mục với slug "${dto.slug}"`,
        );
      }
      throw error;
    }
  }

  async removeItem(projectSlug: string, itemSlug: string) {
    const item = await this.findItemBySlug(projectSlug, itemSlug);
    await this.prisma.projectItem.delete({ where: { id: item.id } });
    return { deleted: true };
  }

  /* ------------------------------- Thư viện ảnh ---------------------------- */

  async findGallery(projectSlug: string, publishedOnly = false) {
    const project = await this.findBySlug(projectSlug, publishedOnly);
    return this.prisma.projectGalleryImage.findMany({
      where: { projectId: project.id },
      orderBy: BY_ORDER,
    });
  }

  /**
   * Thêm một ảnh vào thư viện dự án. `itemSlug` gắn ảnh vào hạng mục con —
   * hạng mục phải thuộc đúng dự án này (findItemBySlug đã kiểm tra).
   */
  async addGalleryImage(projectSlug: string, dto: CreateGalleryImageDto) {
    const project = await this.findBySlug(projectSlug);
    const projectItemId = dto.itemSlug
      ? (await this.findItemBySlug(projectSlug, dto.itemSlug)).id
      : null;

    // Không truyền `order` thì xếp ảnh mới xuống cuối thư viện.
    const order = dto.order ?? (await this.nextGalleryOrder(project.id));

    return this.prisma.projectGalleryImage.create({
      data: {
        projectId: project.id,
        projectItemId,
        url: dto.url,
        caption: dto.caption as unknown as Prisma.InputJsonValue,
        order,
      },
    });
  }

  async updateGalleryImage(
    projectSlug: string,
    imageId: string,
    dto: UpdateGalleryImageDto,
  ) {
    const image = await this.findGalleryImage(projectSlug, imageId);
    const projectItemId =
      dto.itemSlug === undefined
        ? undefined
        : dto.itemSlug === ''
          ? null // chuỗi rỗng = gỡ ảnh khỏi hạng mục, trả về cấp dự án
          : (await this.findItemBySlug(projectSlug, dto.itemSlug)).id;

    return this.prisma.projectGalleryImage.update({
      where: { id: image.id },
      data: {
        url: dto.url,
        caption: dto.caption as unknown as Prisma.InputJsonValue | undefined,
        order: dto.order,
        projectItemId,
      },
    });
  }

  async removeGalleryImage(projectSlug: string, imageId: string) {
    const image = await this.findGalleryImage(projectSlug, imageId);
    await this.prisma.projectGalleryImage.delete({ where: { id: image.id } });
    return { deleted: true };
  }

  /**
   * Sắp xếp lại thư viện theo danh sách id truyền lên (kéo-thả ở Admin CMS).
   * Chạy trong transaction: thứ tự hiển thị không được rơi vào trạng thái nửa vời.
   */
  async reorderGallery(projectSlug: string, imageIds: string[]) {
    const project = await this.findBySlug(projectSlug);
    const owned = await this.prisma.projectGalleryImage.findMany({
      where: { projectId: project.id },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((image) => image.id));

    const unknownId = imageIds.find((id) => !ownedIds.has(id));
    if (unknownId) {
      throw new NotFoundException(
        `Ảnh ${unknownId} không thuộc dự án ${projectSlug}`,
      );
    }
    if (imageIds.length !== owned.length) {
      throw new ConflictException(
        `Cần đủ ${owned.length} ảnh của dự án để sắp xếp lại, nhận được ${imageIds.length}`,
      );
    }

    await this.prisma.$transaction(
      imageIds.map((id, order) =>
        this.prisma.projectGalleryImage.update({
          where: { id },
          data: { order },
        }),
      ),
    );
    return this.findGallery(projectSlug);
  }

  /** Ảnh phải thuộc đúng dự án trên URL — chặn sửa/xóa chéo dự án. */
  private async findGalleryImage(projectSlug: string, imageId: string) {
    const project = await this.findBySlug(projectSlug);
    const image = await this.prisma.projectGalleryImage.findFirst({
      where: { id: imageId, projectId: project.id },
    });
    if (!image) throw new NotFoundException('Không tìm thấy ảnh trong dự án');
    return image;
  }

  private async nextGalleryOrder(projectId: string): Promise<number> {
    const last = await this.prisma.projectGalleryImage.findFirst({
      where: { projectId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return last ? last.order + 1 : 0;
  }
}
