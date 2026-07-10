import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SearchQueryDto } from './dto/search-query.dto';

/** Chỉ cần id + rank từ SQL thô; phần dữ liệu lấy lại bằng Prisma. */
type RankedRow = { id: string };

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search({ q, type, limit }: SearchQueryDto) {
    const [projects, news] = await Promise.all([
      type === 'news' ? Promise.resolve([]) : this.searchProjects(q, limit),
      type === 'projects' ? Promise.resolve([]) : this.searchNews(q, limit),
    ]);
    return { query: q, projects, news };
  }

  /**
   * Hai bước: SQL thô lọc + xếp hạng (dùng index GIN), rồi Prisma nạp lại bản
   * ghi với cùng `include` như `GET /projects` để frontend tái dùng mapper sẵn có.
   */
  private async searchProjects(q: string, limit: number) {
    const ranked = await this.prisma.$queryRaw<RankedRow[]>`
      SELECT p."id"
      FROM "projects" p, websearch_to_tsquery('simple', ${q}) AS query
      WHERE p."content_status" = 'PUBLISHED'::"ContentStatus"
        AND project_search_document(
              p."title", p."summary", p."description", p."category", p."location"
            ) @@ query
      ORDER BY ts_rank(
                 project_search_document(
                   p."title", p."summary", p."description", p."category", p."location"
                 ),
                 query
               ) DESC,
               p."order" ASC
      LIMIT ${limit}
    `;
    if (ranked.length === 0) return [];

    const projects = await this.prisma.project.findMany({
      where: { id: { in: ranked.map((row) => row.id) } },
      include: {
        items: { orderBy: { order: 'asc' } },
        _count: { select: { galleryImages: true } },
      },
    });
    return sortByRankedIds(projects, ranked);
  }

  private async searchNews(q: string, limit: number) {
    const ranked = await this.prisma.$queryRaw<RankedRow[]>`
      SELECT n."id"
      FROM "news_posts" n, websearch_to_tsquery('simple', ${q}) AS query
      WHERE n."status" = 'PUBLISHED'::"ContentStatus"
        AND news_search_document(n."title", n."summary", n."content", n."author") @@ query
      ORDER BY ts_rank(
                 news_search_document(n."title", n."summary", n."content", n."author"),
                 query
               ) DESC,
               n."published_at" DESC NULLS LAST
      LIMIT ${limit}
    `;
    if (ranked.length === 0) return [];

    const posts = await this.prisma.newsPost.findMany({
      where: { id: { in: ranked.map((row) => row.id) } },
      include: { category: true },
    });
    return sortByRankedIds(posts, ranked);
  }
}

/** `findMany` trả theo thứ tự tùy ý — khôi phục lại thứ hạng của câu SQL. */
function sortByRankedIds<T extends { id: string }>(
  rows: T[],
  ranked: RankedRow[],
): T[] {
  const rankById = new Map(ranked.map((row, index) => [row.id, index]));
  return [...rows].sort(
    (first, second) =>
      (rankById.get(first.id) ?? 0) - (rankById.get(second.id) ?? 0),
  );
}
