import { PartialType } from '@nestjs/swagger';
import { CreateMediaAssetDto } from './create-media-asset.dto';

export class UpdateMediaAssetDto extends PartialType(CreateMediaAssetDto) {}
