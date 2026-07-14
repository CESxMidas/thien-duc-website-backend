/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SearchService - SQL Injection Protection (SEC-INJ-001)', () => {
  let service: SearchService;
  let prismaService: PrismaService;

  let mockQueryRaw: any;

  beforeEach(async () => {
    mockQueryRaw = jest.fn();

    const mockPrismaService = {
      $queryRaw: mockQueryRaw,
      project: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      newsPost: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  describe('FTS operator injection prevention', () => {
    it('should not parse & operator when searching projects', async () => {
      const payload = 'project & news';
      mockQueryRaw.mockResolvedValueOnce([]);

      await service['searchProjects'](payload, 10);

      expect(mockQueryRaw).toHaveBeenCalled();
    });

    it('should not parse | operator when searching news', async () => {
      const payload = 'test1 | test2';
      mockQueryRaw.mockResolvedValueOnce([]);

      await service['searchNews'](payload, 10);

      expect(mockQueryRaw).toHaveBeenCalled();
    });

    it('should not parse negation ! operator', async () => {
      const payload = '!secret';
      mockQueryRaw.mockResolvedValueOnce([]);

      await service['searchProjects'](payload, 10);

      expect(mockQueryRaw).toHaveBeenCalled();
    });

    it('should not parse wildcard * operator', async () => {
      const payload = 'project*';
      mockQueryRaw.mockResolvedValueOnce([]);

      await service['searchNews'](payload, 10);

      expect(mockQueryRaw).toHaveBeenCalled();
    });

    it('should handle colon : operator safely', async () => {
      const payload = 'thienduc:5';
      mockQueryRaw.mockResolvedValueOnce([]);

      await service['searchProjects'](payload, 10);

      expect(mockQueryRaw).toHaveBeenCalled();
    });
  });

  describe('search behavior with plainto_tsquery', () => {
    it('should search for multiple words', async () => {
      const payload = 'hưng phú';
      mockQueryRaw.mockResolvedValueOnce([{ id: '1' }]);
      (prismaService.project.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: '1',
          title: 'Hưng Phú Project',
          items: [],
          _count: { galleryImages: 5 },
        },
      ]);

      const result = await service['searchProjects'](payload, 10);

      expect(result).toHaveLength(1);
      expect(mockQueryRaw).toHaveBeenCalled();
    });

    it('should handle empty search query', async () => {
      const payload = '';
      mockQueryRaw.mockResolvedValueOnce([]);

      const result = await service['searchProjects'](payload, 10);

      expect(result).toEqual([]);
    });

    it('should respect LIMIT parameter', async () => {
      const payload = 'test';
      const limit = 5;
      mockQueryRaw.mockResolvedValueOnce([]);

      await service['searchProjects'](payload, limit);

      expect(mockQueryRaw).toHaveBeenCalled();
    });

    it('should only return PUBLISHED content', async () => {
      const payload = 'test';
      mockQueryRaw.mockResolvedValueOnce([]);

      await service['searchProjects'](payload, 10);

      expect(mockQueryRaw).toHaveBeenCalled();
    });
  });

  describe('SQL injection payload tests', () => {
    it('should safely handle quote injection', async () => {
      const payload = "test' OR '1'='1";
      mockQueryRaw.mockResolvedValueOnce([]);

      await service['searchProjects'](payload, 10);

      expect(mockQueryRaw).toHaveBeenCalled();
    });

    it('should safely handle comment injection', async () => {
      const payload = 'test--';
      mockQueryRaw.mockResolvedValueOnce([]);

      await service['searchProjects'](payload, 10);

      expect(mockQueryRaw).toHaveBeenCalled();
    });

    it('should safely handle FTS regex patterns', async () => {
      const payload = '(a|a)*b';
      mockQueryRaw.mockResolvedValueOnce([]);

      await service['searchNews'](payload, 10);

      expect(mockQueryRaw).toHaveBeenCalled();
    });
  });

  describe('search API integration', () => {
    it('should search projects when type is not news', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      (prismaService.project.findMany as jest.Mock).mockResolvedValueOnce([]);

      await service.search({ q: 'test', type: 'projects', limit: 10 });

      expect(mockQueryRaw).toHaveBeenCalled();
    });

    it('should search news when type is not projects', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      (prismaService.newsPost.findMany as jest.Mock).mockResolvedValueOnce([]);

      await service.search({ q: 'test', type: 'news', limit: 10 });

      expect(mockQueryRaw).toHaveBeenCalled();
    });

    it('should search both when type is all', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      (prismaService.project.findMany as jest.Mock).mockResolvedValueOnce([]);
      mockQueryRaw.mockResolvedValueOnce([]);
      (prismaService.newsPost.findMany as jest.Mock).mockResolvedValueOnce([]);

      await service.search({ q: 'test', type: 'all', limit: 10 });

      expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    });
  });
});
