import { Module } from '@nestjs/common';
import { createSqlRanker, type Db } from '@attn/core';
import type { Config, Source, Taxonomy } from '@attn/shared';
import { AuthModule } from '../auth/auth.module';
import { APP_CONFIG, DB, RANKER, SOURCES, TAXONOMY } from '../tokens';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';

@Module({
  imports: [AuthModule],
  controllers: [FeedController],
  providers: [
    FeedService,
    {
      provide: RANKER,
      inject: [DB, APP_CONFIG, SOURCES, TAXONOMY],
      useFactory: (db: Db, config: Config, sources: Source[], taxonomy: Taxonomy) =>
        createSqlRanker(db, { config, sources, taxonomy }),
    },
  ],
  exports: [FeedService],
})
export class FeedModule {}
