import {
  type ExecutionContext,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { ProjectsController } from '../projects/projects.controller';
import { ProjectsService } from '../projects/projects.service';
import { ProjectsSchedulerService } from '../projects/projects-scheduler.service';
import { NewsController } from '../news/news.controller';
import { NewsService } from '../news/news.service';
import { NewsSchedulerService } from '../news/news-scheduler.service';
import { RecruitmentPositionsController } from '../recruitment-positions/recruitment-positions.controller';
import { RecruitmentPositionsService } from '../recruitment-positions/recruitment-positions.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

describe('Route HTTP sắp xếp nội dung', () => {
  let app: INestApplication;
  let server: Server;
  const ids = ['00000000-0000-4000-8000-000000000001'];
  const service = {
    reorder: jest.fn().mockResolvedValue({ reordered: 1 }),
    reorderItems: jest.fn().mockResolvedValue({ reordered: 1 }),
    update: jest.fn().mockResolvedValue({ saved: true }),
    updateItem: jest.fn().mockResolvedValue({ saved: true }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        ProjectsController,
        NewsController,
        RecruitmentPositionsController,
      ],
      providers: [
        { provide: ProjectsService, useValue: service },
        { provide: NewsService, useValue: service },
        { provide: RecruitmentPositionsService, useValue: service },
        { provide: ProjectsSchedulerService, useValue: {} },
        { provide: NewsSchedulerService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<{
            user: { role: string };
            headers: Record<string, string>;
          }>();
          req.user = { role: req.headers['x-test-role'] ?? 'ADMIN' };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['projects', 'news', 'recruitment-positions'])(
    'route admin của %s nhận danh sách hợp lệ',
    async (domain) => {
      await request(server)
        .patch(`/api/${domain}/admin/reorder`)
        .send({ ids })
        .expect(200);
    },
  );

  it('route hạng mục truyền đúng dự án cha', async () => {
    await request(server)
      .patch('/api/projects/admin/parent/items/reorder')
      .send({ ids })
      .expect(200);
    expect(service.reorderItems).toHaveBeenCalledWith('parent', ids);
  });

  it('EDITOR không đổi được thứ tự, kể cả payload hợp lệ', async () => {
    await request(server)
      .patch('/api/projects/admin/reorder')
      .set('x-test-role', 'EDITOR')
      .send({ ids })
      .expect(403);
  });

  it('reject 400 với UUID sai, ID trùng và field không khai báo', async () => {
    for (const body of [
      { ids: ['bad'] },
      { ids: [ids[0], ids[0]] },
      { ids, title: 'forbidden' },
    ]) {
      await request(server)
        .patch('/api/news/admin/reorder')
        .send(body)
        .expect(400);
    }
  });

  it('không chiếm route sửa nội dung hoặc hạng mục có slug reorder', async () => {
    await request(server)
      .patch('/api/projects/reorder')
      .send({ title: { vi: 'Tên mới' } })
      .expect(200);
    expect(service.update).toHaveBeenCalledWith(
      'reorder',
      expect.objectContaining({ title: { vi: 'Tên mới' } }),
      'ADMIN',
    );
    await request(server)
      .patch('/api/projects/parent/items/reorder')
      .send({ title: { vi: 'Hạng mục' } })
      .expect(200);
    expect(service.updateItem).toHaveBeenCalledWith(
      'parent',
      'reorder',
      expect.objectContaining({ title: { vi: 'Hạng mục' } }),
      'ADMIN',
    );
  });
});
