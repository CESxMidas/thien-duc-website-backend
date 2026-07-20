import { Test } from '@nestjs/testing';
import {
  ContentStatus,
  ProjectStatus,
  Role,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';

/**
 * ADMIN-SUPER-ADMIN-GLOBAL-APPROVAL-BYPASS-M1: SUPER_ADMIN tạo dự án → xuất bản
 * ngay (contentStatus = PUBLISHED); vai trò khác vẫn nháp (DRAFT). Bao thêm một
 * module thứ hai ngoài News để chắc luồng bỏ qua duyệt dùng chung, đồng nhất.
 */
const dto: CreateProjectDto = {
  slug: 'du-an-moi',
  title: { vi: 'Dự án', en: 'Project' },
  summary: { vi: 'Tóm tắt dự án', en: 'Summary' },
  status: ProjectStatus.DANG_THI_CONG,
};

describe('ProjectsService.create (bypass duyệt cho SUPER_ADMIN)', () => {
  let service: ProjectsService;
  let prisma: { project: { create: jest.Mock } };

  beforeEach(async () => {
    prisma = { project: { create: jest.fn() } };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(ProjectsService);
    prisma.project.create.mockResolvedValue({ id: 'p1' });
  });

  it('SUPER_ADMIN → contentStatus PUBLISHED', async () => {
    await service.create(dto, Role.SUPER_ADMIN);

    const [{ data }] = prisma.project.create.mock.calls[0] as [
      { data: { contentStatus: ContentStatus } },
    ];
    expect(data.contentStatus).toBe(ContentStatus.PUBLISHED);
  });

  it('EDITOR → contentStatus DRAFT (giữ luồng duyệt)', async () => {
    await service.create(dto, Role.EDITOR);

    const [{ data }] = prisma.project.create.mock.calls[0] as [
      { data: { contentStatus: ContentStatus } },
    ];
    expect(data.contentStatus).toBe(ContentStatus.DRAFT);
  });
});
