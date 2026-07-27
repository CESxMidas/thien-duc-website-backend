import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { E2eAwareThrottlerGuard } from './common/guards/e2e-aware-throttler.guard';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { NewsModule } from './news/news.module';
import { PagesModule } from './pages/pages.module';
import { BannersModule } from './banners/banners.module';
import { CooperationModule } from './cooperation/cooperation.module';
import { ContactModule } from './contact/contact.module';
import { MediaModule } from './media/media.module';
import { SearchModule } from './search/search.module';
import { TestSupportModule } from './test-support/test-support.module';

/**
 * Module hỗ trợ test chỉ được nạp khi CẢ HAI đúng: NODE_ENV=test và cờ tường
 * minh MAIL_FAKE_TRANSPORT=1. Ở production mảng này rỗng nên route /api/test/*
 * không hề tồn tại trong runtime.
 */
const testSupportModules =
  (process.env.NODE_ENV ?? 'production') === 'test' &&
  process.env.MAIL_FAKE_TRANSPORT === '1'
    ? [TestSupportModule]
    : [];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    NewsModule,
    PagesModule,
    BannersModule,
    CooperationModule,
    ContactModule,
    MediaModule,
    SearchModule,
    ...testSupportModules,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: E2eAwareThrottlerGuard },
  ],
})
export class AppModule {}
