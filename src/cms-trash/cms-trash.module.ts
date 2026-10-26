import { Module } from '@nestjs/common';
import { CmsTrashController } from './cms-trash.controller';
import { CmsTrashService } from './cms-trash.service';

@Module({ controllers: [CmsTrashController], providers: [CmsTrashService] })
export class CmsTrashModule {}
