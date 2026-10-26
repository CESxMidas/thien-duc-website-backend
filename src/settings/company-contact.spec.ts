import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { DEFAULT_COMPANY_CONTACT } from './company-contact';

describe('Thông tin liên hệ công ty', () => {
  let app: INestApplication;
  let service: SettingsService;
  const prisma = { siteSetting: { findUnique: jest.fn(), upsert: jest.fn() } };
  const contact = {
    ...DEFAULT_COMPANY_CONTACT,
    phone: '028 1234 5678',
    email: 'contact@thienduc.vn',
    address: { vi: 'Địa chỉ mới' },
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: prisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<{
            user: { role: string };
            headers: Record<string, string>;
          }>();
          req.user = { role: req.headers['x-role'] ?? 'EDITOR' };
          return Boolean(req.headers['x-role']);
        },
      })
      .compile();
    service = module.get(SettingsService);
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.siteSetting.findUnique.mockResolvedValue(null);
  });
  afterAll(async () => {
    await app.close();
  });

  it('công khai thông tin đã xác nhận trước lần lưu đầu tiên', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/settings/company-contact')
      .expect(200);
    expect(response.body).toEqual(DEFAULT_COMPANY_CONTACT);
    expect(prisma.siteSetting.upsert).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'SUPER_ADMIN'])(
    '%s lưu bền vững đúng key, không sửa thương hiệu',
    async (role) => {
      await request(app.getHttpServer() as Server)
        .patch('/settings/company-contact')
        .set('x-role', role)
        .send({ ...contact, email: ` ${contact.email} ` })
        .expect(200, contact);
      expect(prisma.siteSetting.upsert).toHaveBeenCalledWith({
        where: { key: 'company-contact' },
        create: { key: 'company-contact', value: contact },
        update: { value: contact },
      });
      prisma.siteSetting.findUnique.mockResolvedValue({ value: contact });
      expect(await service.getCompanyContact()).toEqual(contact);
    },
  );

  it('không cho EDITOR hoặc khách ghi dữ liệu', async () => {
    for (const role of ['EDITOR', '']) {
      await request(app.getHttpServer() as Server)
        .patch('/settings/company-contact')
        .set('x-role', role)
        .send(contact)
        .expect(403);
    }
    expect(prisma.siteSetting.upsert).not.toHaveBeenCalled();
  });

  it('từ chối dữ liệu thiếu, null, sai định dạng và trường ngoài hợp đồng', async () => {
    for (const payload of [
      {},
      { ...contact, phone: '123' },
      { ...contact, phone: 'call123456789' },
      { ...contact, email: 'sai-email' },
      { ...contact, taxCode: 'abc' },
      { ...contact, address: null },
      { ...contact, address: [{ vi: 'Địa chỉ' }] },
      { ...contact, address: { vi: '   ' } },
      { ...contact, address: { vi: 'a'.repeat(501) } },
      { ...contact, address: { vi: 'Địa chỉ', en: 123 } },
      { ...contact, address: { vi: 'Địa chỉ', extra: true } },
      { ...contact, logoUrl: 'không được thay đổi' },
    ]) {
      await request(app.getHttpServer() as Server)
        .patch('/settings/company-contact')
        .set('x-role', 'ADMIN')
        .send(payload)
        .expect(400);
    }
    expect(prisma.siteSetting.upsert).not.toHaveBeenCalled();
  });

  it('xoá bản dịch cũ khi để trống EN, không giữ địa chỉ tiếng Anh đã lỗi thời', async () => {
    prisma.siteSetting.findUnique.mockResolvedValue({
      value: DEFAULT_COMPANY_CONTACT,
    });
    const result = await service.updateCompanyContact({
      ...contact,
      address: { vi: ' Địa chỉ mới ', en: '  ' },
    });
    expect(result.address).toEqual({ vi: 'Địa chỉ mới' });
  });
});
