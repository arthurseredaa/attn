import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { createGeminiLabeler, type Db, type Labeler } from "@attn/core";
import type { Config, Source, Taxonomy } from "@attn/shared";
import type { Env } from "../config/env";
import {
  APP_CONFIG,
  DB,
  ENV,
  LABELER,
  PIPELINE_STEPS,
  SOURCES,
  TAXONOMY,
} from "../tokens";
import { PipelineJob } from "./pipeline.job";
import { PipelineScheduler } from "./pipeline.scheduler";
import { createPipelineSteps } from "./pipeline.steps";

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    {
      provide: LABELER,
      inject: [ENV, TAXONOMY],
      useFactory: (env: Env, taxonomy: Taxonomy): Labeler | null =>
        env.labelModel && env.googleApiKey
          ? createGeminiLabeler({
              model: env.labelModel,
              taxonomy,
              apiKey: env.googleApiKey,
            })
          : null,
    },
    {
      provide: PIPELINE_STEPS,
      inject: [DB, SOURCES, APP_CONFIG, TAXONOMY, LABELER],
      useFactory: (
        db: Db,
        sources: Source[],
        config: Config,
        taxonomy: Taxonomy,
        labeler: Labeler | null,
      ) => createPipelineSteps({ db, sources, config, taxonomy, labeler }),
    },
    PipelineJob,
    PipelineScheduler,
  ],
  exports: [PipelineJob],
})
export class JobsModule {}
