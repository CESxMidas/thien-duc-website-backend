import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, Prisma, Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecruitmentPositionsService } from './recruitment-positions.service';
import { CreateRecruitmentPositionDto } from './dto/create-recruitment-position.dto';

const translated = { vi: 'Nội dung', en: 'Content' };
const translatedList = { vi: ['Mục tiếng Việt'], en: ['English item'] };

function position(overrides: Record<string, unknown> = {}) {
  return {
    id: 'position-id',
    slug: 'ky-su-xay-dung',
    title: translated,
    department: translated,
    location: translated,
    type: translated,
    summary: translated,
    responsibilities: translatedList,
    requirements: translatedList,
    benefits: translatedList,
    deadline: new Date('2026-12-31T00:00:00.000Z'),
    status: ContentStatus.DRAFT,
    order: 0,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('RecruitmentPositionsService', () => {
  let service: RecruitmentPositionsService;
  let prisma: {
    recruitmentPosition: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      recruitmentPosition: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new RecruitmentPositionsService(
      prisma as unknown as PrismaService,
    );
  });

  it('returns only published positions and keeps the Vietnam deadline inclusive for the whole day', async () => {
    prisma.recruitmentPosition.findMany.mockResolvedValue([position()]);
    const beforeVietnamMidnight = new Date('2026-10-22T16:59:59.999Z');

    const result = await service.findAllPublic(beforeVietnamMidnight);

    expect(prisma.recruitmentPosition.findMany).toHaveBeenCalledWith({
      where: {
        status: ContentStatus.PUBLISHED,
        OR: [
          { deadline: null },
          { deadline: { gte: new Date('2026-10-22T00:00:00.000Z') } },
        ],
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    });
    expect(result[0].deadline).toBe('2026-12-31');
  });

  it('advances the public deadline boundary at midnight in Vietnam', async () => {
    prisma.recruitmentPosition.findMany.mockResolvedValue([]);

    await service.findAllPublic(new Date('2026-10-22T17:00:00.000Z'));

    expect(prisma.recruitmentPosition.findMany).toHaveBeenCalledWith({
      where: {
        status: ContentStatus.PUBLISHED,
        OR: [
          { deadline: null },
          { deadline: { gte: new Date('2026-10-23T00:00:00.000Z') } },
        ],
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    });
  });

  it('lists all statuses for Admin and formats date-only deadlines', async () => {
    prisma.recruitmentPosition.findMany.mockResolvedValue([
      position({ status: ContentStatus.PENDING }),
    ]);

    const result = await service.findAllForAdmin();

    expect(prisma.recruitmentPosition.findMany).toHaveBeenCalledWith({
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    });
    expect(result[0]).toMatchObject({
      status: ContentStatus.PENDING,
      deadline: '2026-12-31',
    });
  });

  it('creates a draft by default and persists a date-only deadline as a database date', async () => {
    prisma.recruitmentPosition.create.mockResolvedValue(position());
    const dto = {
      slug: 'ky-su-xay-dung',
      title: translated,
      department: translated,
      location: translated,
      type: translated,
      summary: translated,
      responsibilities: translatedList,
      requirements: translatedList,
      benefits: translatedList,
      deadline: '2026-12-31',
    } as CreateRecruitmentPositionDto;

    const result = await service.create(dto, Role.EDITOR);

    expect(prisma.recruitmentPosition.create).toHaveBeenCalledWith({
      data: {
        slug: 'ky-su-xay-dung',
        title: translated,
        department: translated,
        location: translated,
        type: translated,
        summary: translated,
        responsibilities: translatedList,
        requirements: translatedList,
        benefits: translatedList,
        deadline: new Date('2026-12-31T00:00:00.000Z'),
        status: ContentStatus.DRAFT,
      },
    });
    expect(result.deadline).toBe('2026-12-31');
  });

  it('prevents editors from creating a position outside DRAFT', async () => {
    await expect(
      service.create(
        {
          slug: 'ky-su-xay-dung',
          title: translated,
          department: translated,
          location: translated,
          type: translated,
          summary: translated,
          responsibilities: translatedList,
          requirements: translatedList,
          benefits: translatedList,
          status: ContentStatus.PUBLISHED,
        },
        Role.EDITOR,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.recruitmentPosition.create).not.toHaveBeenCalled();
  });

  it('prevents editors from modifying a position already sent for review', async () => {
    prisma.recruitmentPosition.findUnique.mockResolvedValue(
      position({ status: ContentStatus.PENDING }),
    );

    await expect(
      service.update(
        'position-id',
        { status: ContentStatus.DRAFT },
        Role.EDITOR,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.recruitmentPosition.update).not.toHaveBeenCalled();
  });

  it('allows editors to submit a draft for review', async () => {
    prisma.recruitmentPosition.findUnique.mockResolvedValue(position());
    prisma.recruitmentPosition.update.mockResolvedValue(
      position({ status: ContentStatus.PENDING }),
    );

    const result = await service.update(
      'position-id',
      { status: ContentStatus.PENDING },
      Role.EDITOR,
    );

    expect(prisma.recruitmentPosition.update).toHaveBeenCalledWith({
      where: { id: 'position-id' },
      data: { status: ContentStatus.PENDING },
    });
    expect(result.status).toBe(ContentStatus.PENDING);
  });

  it('prevents editors from publishing drafts directly', async () => {
    prisma.recruitmentPosition.findUnique.mockResolvedValue(position());

    await expect(
      service.update(
        'position-id',
        { status: ContentStatus.PUBLISHED },
        Role.EDITOR,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.recruitmentPosition.update).not.toHaveBeenCalled();
  });

  it('updates supplied fields and preserves a cleared deadline as null', async () => {
    prisma.recruitmentPosition.findUnique.mockResolvedValue(position());
    prisma.recruitmentPosition.update.mockResolvedValue(
      position({ deadline: null, summary: { vi: 'Tóm tắt mới' } }),
    );

    const result = await service.update(
      'position-id',
      { deadline: null, summary: { vi: 'Tóm tắt mới' } },
      Role.ADMIN,
    );

    expect(prisma.recruitmentPosition.update).toHaveBeenCalledWith({
      where: { id: 'position-id' },
      data: { deadline: null, summary: { vi: 'Tóm tắt mới' } },
    });
    expect(result.deadline).toBeNull();
  });

  it('deletes an existing position', async () => {
    prisma.recruitmentPosition.findUnique.mockResolvedValue(position());
    prisma.recruitmentPosition.delete.mockResolvedValue(position());

    await expect(service.remove('position-id')).resolves.toEqual({
      deleted: true,
    });
    expect(prisma.recruitmentPosition.delete).toHaveBeenCalledWith({
      where: { id: 'position-id' },
    });
  });

  it('returns 404 for an unknown Admin detail id', async () => {
    prisma.recruitmentPosition.findUnique.mockResolvedValue(null);

    await expect(service.findOneForAdmin('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('converts duplicate slugs to 409', async () => {
    prisma.recruitmentPosition.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const dto = {
      slug: 'ky-su-xay-dung',
      title: translated,
      department: translated,
      location: translated,
      type: translated,
      summary: translated,
      responsibilities: translatedList,
      requirements: translatedList,
      benefits: translatedList,
    } as CreateRecruitmentPositionDto;

    await expect(service.create(dto, Role.ADMIN)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
