import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import type { Db, Labeler } from '@attn/core';
import type { Config, Source, Taxonomy } from '@attn/shared';
import type { Env } from '../config/env';
import { APP_CONFIG, DB, ENV, LABELER, PIPELINE_STEPS, SOURCES, TAXONOMY } from '../tokens';
import { PipelineJob } from './pipeline.job';
import { PipelineScheduler } from './pipeline.scheduler';
import { createPipelineSteps, labelerFromEnv } from './pipeline.steps';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    {
      provide: LABELER,
      inject: [ENV, TAXONOMY, APP_CONFIG],
      useFactory: (env: Env, taxonomy: Taxonomy, config: Config): Labeler | null =>
        labelerFromEnv(env, taxonomy, config),
    },
    {
      provide: PIPELINE_STEPS,
      inject: [DB, SOURCES, APP_CONFIG, TAXONOMY, LABELER],
      useFactory: (db: Db, sources: Source[], config: Config, taxonomy: Taxonomy, labeler: Labeler | null) =>
        createPipelineSteps({ db, sources, config, taxonomy, labeler }),
    },
    PipelineJob,
    PipelineScheduler,
  ],
  exports: [PipelineJob],
})
export class JobsModule {}
