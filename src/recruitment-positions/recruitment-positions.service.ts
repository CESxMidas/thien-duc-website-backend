import { CONTENT_ORDER, reorderContent } from '../common/content-order';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, Prisma, Role } from '../../generated/prisma/client';
import { json } from '../common/prisma-json';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRecruitmentPositionDto } from './dto/create-recruitment-position.dto';
import { UpdateRecruitmentPositionDto } from './dto/update-recruitment-position.dto';

const UNIQUE_CONSTRAINT = 'P2002';

type RecruitmentPositionRecord = {
  deadline: Date | null;
};

function serializeDeadline<T extends RecruitmentPositionRecord>(position: T) {
  return {
    ...position,
    deadline: position.deadline?.toISOString().slice(0, 10) ?? null,
  };
}

function vietnameseToday(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return new Date(
    Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)),
  );
}

function dateOnlyToUtcDate(value: string | null | undefined) {
  if (value == null) return value;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

@Injectable()
export class RecruitmentPositionsService {
  constructor(private readonly prisma: PrismaService) {}

  reorder(ids: string[]) {
    return reorderContent(this.prisma, 'recruitmentPosition', ids);
  }

  async findAllPublic(now = new Date()) {
    const positions = await this.prisma.recruitmentPosition.findMany({
      where: {
        status: ContentStatus.PUBLISHED,
        OR: [{ deadline: null }, { deadline: { gte: vietnameseToday(now) } }],
      },
      orderBy: [...CONTENT_ORDER],
    });
    return positions.map(serializeDeadline);
  }

  async findAllForAdmin() {
    const positions = await this.prisma.recruitmentPosition.findMany({
      orderBy: [...CONTENT_ORDER],
    });
    return positions.map(serializeDeadline);
  }

  async findOneForAdmin(id: string) {
    const position = await this.prisma.recruitmentPosition.findUnique({
      where: { id },
    });
    if (!position) {
      throw new NotFoundException('Không tìm thấy vị trí tuyển dụng');
    }
    return serializeDeadline(position);
  }

  async create(dto: CreateRecruitmentPositionDto, actorRole: string) {
    this.assertEditorCanOnlyCreateDraft(actorRole, dto.status);
    const {
      deadline,
      title,
      department,
      location,
      type,
      summary,
      responsibilities,
      requirements,
      benefits,
      ...scalars
    } = dto;

    try {
      const position = await this.prisma.recruitmentPosition.create({
        data: {
          ...scalars,
          title: json(title),
          department: json(department),
          location: json(location),
          type: json(type),
          summary: json(summary),
          responsibilities: json(responsibilities),
          requirements: json(requirements),
          benefits: json(benefits),
          deadline: dateOnlyToUtcDate(deadline),
          status: dto.status ?? ContentStatus.DRAFT,
        } satisfies Prisma.RecruitmentPositionCreateInput,
      });
      return serializeDeadline(position);
    } catch (error) {
      this.rethrowSlugConflict(error);
    }
  }

  async update(
    id: string,
    dto: UpdateRecruitmentPositionDto,
    actorRole: string,
  ) {
    const current = await this.findOneForAdmin(id);
    if (actorRole === Role.EDITOR && current.status !== ContentStatus.DRAFT) {
      throw new ForbiddenException(
        'Biên tập viên chỉ được sửa vị trí tuyển dụng ở trạng thái nháp',
      );
    }
    this.assertEditorCanOnlySubmitForReview(actorRole, dto.status);

    const {
      deadline,
      title,
      department,
      location,
      type,
      summary,
      responsibilities,
      requirements,
      benefits,
      ...scalars
    } = dto;
    const data: Prisma.RecruitmentPositionUpdateInput = {
      ...scalars,
      ...(deadline !== undefined
        ? { deadline: dateOnlyToUtcDate(deadline) }
        : {}),
      ...(title !== undefined ? { title: json(title) } : {}),
      ...(department !== undefined ? { department: json(department) } : {}),
      ...(location !== undefined ? { location: json(location) } : {}),
      ...(type !== undefined ? { type: json(type) } : {}),
      ...(summary !== undefined ? { summary: json(summary) } : {}),
      ...(responsibilities !== undefined
        ? { responsibilities: json(responsibilities) }
        : {}),
      ...(requirements !== undefined
        ? { requirements: json(requirements) }
        : {}),
      ...(benefits !== undefined ? { benefits: json(benefits) } : {}),
    };

    try {
      const position = await this.prisma.recruitmentPosition.update({
        where: { id },
        data,
      });
      return serializeDeadline(position);
    } catch (error) {
      this.rethrowSlugConflict(error);
    }
  }

  async remove(id: string) {
    await this.findOneForAdmin(id);
    await this.prisma.recruitmentPosition.delete({ where: { id } });
    return { deleted: true };
  }

  private assertEditorCanOnlyCreateDraft(
    role: string,
    status: CreateRecruitmentPositionDto['status'] | undefined,
  ) {
    if (
      role === Role.EDITOR &&
      status !== undefined &&
      status !== ContentStatus.DRAFT
    ) {
      throw new ForbiddenException(
        'Biên tập viên chỉ được tạo vị trí tuyển dụng ở trạng thái nháp',
      );
    }
  }

  private assertEditorCanOnlySubmitForReview(
    role: string,
    status: CreateRecruitmentPositionDto['status'] | undefined,
  ) {
    if (
      role === Role.EDITOR &&
      status !== undefined &&
      status !== ContentStatus.DRAFT &&
      status !== ContentStatus.PENDING
    ) {
      throw new ForbiddenException(
        'Biên tập viên chỉ được giữ nháp hoặc gửi duyệt vị trí tuyển dụng',
      );
    }
  }

  private rethrowSlugConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_CONSTRAINT
    ) {
      throw new ConflictException('Slug vị trí tuyển dụng đã tồn tại');
    }
    throw error;
  }
}
