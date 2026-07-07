import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class CreateMediaAssetDto {
  @ApiProperty()
  @IsString()
  url!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  publicId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  width?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  height?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  format?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  bytes?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  folder?: string;
}
