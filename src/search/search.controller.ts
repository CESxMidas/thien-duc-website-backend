import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @ApiOperation({
    summary:
      'Tìm kiếm full-text dự án và tin tức đã xuất bản theo từ khóa (YC-10).',
  })
  @ApiResponse({
    status: 200,
    description: 'Kết quả xếp theo độ liên quan (ts_rank).',
  })
  @ApiResponse({ status: 400, description: 'Từ khóa ngắn hơn 2 ký tự.' })
  @Get()
  search(@Query() query: SearchQueryDto) {
    return this.searchService.search(query);
  }
}
