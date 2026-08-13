import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { newsPubliclyVisibleSql } from '../common/publication';
import { SearchQueryDto } from './dto/search-query.dto';

/** Chỉ cần id + rank từ SQL thô; phần dữ liệu lấy lại bằng Prisma. */
type RankedRow = { id: string };

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search({ q, type, limit }: SearchQueryDto) {
    // Một mốc thời gian cho cả lượt tìm kiếm — hai nhánh không được nhìn thấy
    // hai thời điểm khác nhau. Hiện chỉ News dùng tới; Projects chưa có lịch
    // đăng nên vẫn lọc theo `content_status` như cũ (batch riêng của nó).
    const now = new Date();
    const [projects, news] = await Promise.all([
      type === 'news' ? Promise.resolve([]) : this.searchProjects(q, limit),
      type === 'projects'
        ? Promise.resolve([])
        : this.searchNews(q, limit, now),
    ]);
    return { query: q, projects, news };
  }

  /**
   * Hai bước: SQL thô lọc + xếp hạng (dùng index GIN), rồi Prisma nạp lại bản
   * ghi với cùng `include` như `GET /projects` để frontend tái dùng mapper sẵn có.
   */
  private async searchProjects(q: string, limit: number) {
    // SEC-INJ-001: Use plainto_tsquery instead of websearch_to_tsquery to prevent FTS operator injection
    // plainto_tsquery treats input as plain text (no operator parsing), protecting against query manipulation
    //
    // YC-10: `immutable_unaccent` bọc TỪ KHOÁ để khớp với tsvector cũng đã bỏ
    // dấu (xem migration 20260731120000_search_unaccent). Bọc một phía là vô
    // nghĩa: tài liệu bỏ dấu mà truy vấn còn dấu thì không bao giờ khớp.
    // `${q}` vẫn là tham số bind của Prisma — không nối chuỗi, không SQL injection.
    // Qualify `public.` cho đồng bộ với migration: tên không qualify phụ thuộc
    // `search_path` của kết nối, đúng thứ đã làm CI đỏ ở tầng CREATE INDEX.
    const ranked = await this.prisma.$queryRaw<RankedRow[]>`
      SELECT p."id"
      FROM "projects" p, plainto_tsquery('simple', public.immutable_unaccent(${q})) AS query
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

  private async searchNews(q: string, limit: number, now: Date) {
    // SEC-INJ-001: Use plainto_tsquery instead of websearch_to_tsquery to prevent FTS operator injection
    // plainto_tsquery treats input as plain text (no operator parsing), protecting against query manipulation
    //
    // Điều kiện hiển thị lấy từ `newsPubliclyVisibleSql` thay vì gõ lại
    // `status = 'PUBLISHED'`: đây là truy vấn tin duy nhất bằng SQL thô, nên
    // `where` của Prisma không với tới — và cũng vì thế nó là chỗ dễ bị bỏ quên
    // nhất khi luật hiển thị đổi. Mảnh SQL dùng bind parameter cho `now`.
    const ranked = await this.prisma.$queryRaw<RankedRow[]>`
      SELECT n."id"
      FROM "news_posts" n, plainto_tsquery('simple', public.immutable_unaccent(${q})) AS query
      WHERE ${newsPubliclyVisibleSql(now)}
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
