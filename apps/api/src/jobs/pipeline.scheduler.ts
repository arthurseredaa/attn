import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import type { Config } from "@attn/shared";
import { CronJob } from "cron";
import type { Env } from "../config/env";
import { APP_CONFIG, ENV } from "../tokens";
import { PipelineJob } from "./pipeline.job";

export const PIPELINE_CRON_NAME = "pipeline";

@Injectable()
export class PipelineScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(PipelineScheduler.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(APP_CONFIG) private readonly config: Config,
    @Inject(SchedulerRegistry) private readonly registry: SchedulerRegistry,
    @Inject(PipelineJob) private readonly job: PipelineJob,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.scheduleEnabled) {
      this.logger.log("schedule disabled (SCHEDULE_ENABLED=false)");
      return;
    }
    const cron = new CronJob(
      this.config.schedule_cron,
      () => {
        void this.tick();
      },
      null,
      false,
      "UTC",
    );
    this.registry.addCronJob(PIPELINE_CRON_NAME, cron);
    cron.start();
    this.logger.log(`pipeline scheduled: ${this.config.schedule_cron} (UTC)`);
  }

  /** Never rejects: a failed run is logged and the next tick tries again. */
  async tick(): Promise<void> {
    try {
      await this.job.run();
    } catch (err) {
      this.logger.error(
        `scheduled pipeline run failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
