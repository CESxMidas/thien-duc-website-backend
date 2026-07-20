import { Test } from '@nestjs/testing';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContactService } from './contact.service';
import { CreateContactSubmissionDto } from './dto/create-contact-submission.dto';

/**
 * Kiểm thử task →1: gửi email thông báo khi có lead mới. Trọng tâm là hợp đồng
 * của `ContactService.create`:
 *   1. Lưu lead vào DB TRƯỚC.
 *   2. Gọi `MailService.sendContactNotification` với đúng dữ liệu lead.
 *   3. Gửi email KHÔNG chặn — vẫn trả về bản ghi đã lưu.
 *   4. Email hỏng (được nuốt lỗi bên trong MailService) không làm hỏng create.
 *
 * `MailService` được mock hoàn toàn nên test không đụng tới Resend thật — không
 * có API key/secret nào xuất hiện trong test hay output.
 */
const dto: CreateContactSubmissionDto = {
  name: 'Nguyễn Văn A',
  phone: '0900000000',
  email: 'a@example.com',
  inquiryType: 'Báo giá',
  message: 'Xin báo giá dự án Hưng Phú',
};

const savedSubmission = {
  id: 'sub-1',
  name: dto.name,
  phone: dto.phone,
  email: dto.email ?? null,
  inquiryType: dto.inquiryType ?? null,
  message: dto.message,
  status: 'NEW',
  internalNote: null,
  ipAddress: '203.0.113.9',
  createdAt: new Date('2026-07-16T03:00:00.000Z'),
  updatedAt: new Date('2026-07-16T03:00:00.000Z'),
};

describe('ContactService.create (task →1: email thông báo)', () => {
  let service: ContactService;
  let prisma: { contactSubmission: { create: jest.Mock } };
  let mail: { sendContactNotification: jest.Mock };

  beforeEach(async () => {
    prisma = { contactSubmission: { create: jest.fn() } };
    mail = { sendContactNotification: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ContactService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
      ],
    }).compile();

    service = moduleRef.get(ContactService);
    jest.clearAllMocks();
  });

  it('lưu lead vào DB trước khi gửi email, và gửi email sau đó', async () => {
    prisma.contactSubmission.create.mockResolvedValue(savedSubmission);
    mail.sendContactNotification.mockResolvedValue(undefined);

    await service.create(dto, savedSubmission.ipAddress ?? undefined);

    // Lưu DB trước, gửi mail sau — kiểm chứng bằng thứ tự gọi.
    const saveOrder =
      prisma.contactSubmission.create.mock.invocationCallOrder[0];
    const mailOrder = mail.sendContactNotification.mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(mailOrder);

    // Lead được lưu kèm IP đã bắt.
    expect(prisma.contactSubmission.create).toHaveBeenCalledWith({
      data: { ...dto, ipAddress: savedSubmission.ipAddress },
    });
  });

  it('gọi sendContactNotification với đúng dữ liệu lead đã lưu', async () => {
    prisma.contactSubmission.create.mockResolvedValue(savedSubmission);
    mail.sendContactNotification.mockResolvedValue(undefined);

    await service.create(dto, savedSubmission.ipAddress ?? undefined);

    expect(mail.sendContactNotification).toHaveBeenCalledTimes(1);
    expect(mail.sendContactNotification).toHaveBeenCalledWith({
      submissionId: savedSubmission.id,
      name: savedSubmission.name,
      phone: savedSubmission.phone,
      email: savedSubmission.email,
      inquiryType: savedSubmission.inquiryType,
      message: savedSubmission.message,
      ipAddress: savedSubmission.ipAddress,
      createdAt: savedSubmission.createdAt,
    });
  });

  it('trả về bản ghi đã lưu (gửi email không chặn kết quả)', async () => {
    prisma.contactSubmission.create.mockResolvedValue(savedSubmission);
    // Email chưa resolve (pending) — create vẫn phải trả về ngay bản ghi đã lưu.
    mail.sendContactNotification.mockReturnValue(new Promise(() => {}));

    const result = await service.create(dto);

    expect(result).toBe(savedSubmission);
  });

  it('vẫn trả về bản ghi khi MailService xử lý lỗi nội bộ (resolve void)', async () => {
    prisma.contactSubmission.create.mockResolvedValue(savedSubmission);
    // MailService tự nuốt lỗi và resolve void — create không được ném lỗi.
    mail.sendContactNotification.mockResolvedValue(undefined);

    await expect(service.create(dto)).resolves.toBe(savedSubmission);
  });
});
