import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ContentStatus } from '../../../generated/prisma/client';
import { CreateRecruitmentPositionDto } from './create-recruitment-position.dto';
import { UpdateRecruitmentPositionDto } from './update-recruitment-position.dto';

const validPayload = {
  slug: 'ky-su-xay-dung',
  title: { vi: 'Kỹ sư xây dựng' },
  department: { vi: 'Kỹ thuật' },
  location: { vi: 'Bến Tre' },
  type: { vi: 'Toàn thời gian' },
  summary: { vi: 'Mô tả vị trí' },
  responsibilities: { vi: ['Thiết kế'] },
  requirements: { vi: ['Tốt nghiệp chuyên ngành'] },
  benefits: { vi: ['Bảo hiểm'] },
};

function errors(payload: Record<string, unknown>) {
  return validateSync(plainToInstance(CreateRecruitmentPositionDto, payload));
}

describe('recruitment position DTO validation', () => {
  it('accepts a date-only deadline and nullable deadline', () => {
    expect(errors({ ...validPayload, deadline: '2026-12-31' })).toHaveLength(0);
    expect(errors({ ...validPayload, deadline: null })).toHaveLength(0);
  });

  it('rejects timestamps and invalid calendar dates for deadline', () => {
    expect(
      errors({ ...validPayload, deadline: '2026-12-31T00:00:00.000Z' }).length,
    ).toBeGreaterThan(0);
    expect(
      errors({ ...validPayload, deadline: '2026-02-30' }).length,
    ).toBeGreaterThan(0);
  });

  it('accepts the shared PENDING status', () => {
    expect(
      errors({ ...validPayload, status: ContentStatus.PENDING }).length,
    ).toBe(0);
  });

  it('rejects status values outside the shared content status workflow', () => {
    expect(
      errors({ ...validPayload, status: 'ARCHIVED' }).length,
    ).toBeGreaterThan(0);
  });

  it('allows partial updates while validating fields that are supplied', () => {
    expect(
      validateSync(
        plainToInstance(UpdateRecruitmentPositionDto, {
          deadline: '2026-12-31',
        }),
      ),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(UpdateRecruitmentPositionDto, {
          deadline: '2026-12-31T00:00:00.000Z',
        }),
      ).length,
    ).toBeGreaterThan(0);
  });
});
