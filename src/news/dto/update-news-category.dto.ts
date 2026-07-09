import { PartialType } from '@nestjs/swagger';
import { CreateNewsCategoryDto } from './create-news-category.dto';

export class UpdateNewsCategoryDto extends PartialType(CreateNewsCategoryDto) {}
