import { Inject, Injectable, Logger } from "@nestjs/common";
import { withAdvisoryLock } from "@attn/core";
import type { SourceReport } from "@attn/core";
import type { Env } from "../config/env";
import { ENV, PIPELINE_STEPS } from "../tokens";
import type { LabelStepResult, PipelineSteps } from "./pipeline.steps";

export const PIPELINE_LOCK_KEY = 727001;

export type PipelineRunResult =
  | { status: "skipped_locked" }
  | { status: "done"; collect: SourceReport[]; label: LabelStepResult };

@Injectable()
export class PipelineJob {
  private readonly logger = new Logger(PipelineJob.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PIPELINE_STEPS) private readonly steps: PipelineSteps,
  ) {}

  async run(): Promise<PipelineRunResult> {
    const locked = await withAdvisoryLock(
      this.env.databaseUrl,
      PIPELINE_LOCK_KEY,
      async () => {
        this.logger.log("pipeline started");
        const collect = await this.steps.collect();
        const inserted = collect.reduce((n, r) => n + r.inserted, 0);
        const failed = collect.filter((r) => r.status === "error").length;
        this.logger.log(
          `collect: ${collect.length} sources, ${inserted} inserted, ${failed} failed`,
        );
        const label = await this.steps.label();
        if (label.status === "done") {
          this.logger.log(
            `label: ${label.labeled} labeled, ${label.failed} failed of ${label.selected}${label.rateLimited ? " (rate limited)" : ""}`,
          );
        } else {
          this.logger.warn(`label skipped: ${label.reason}`);
        }
        return { collect, label };
      },
    ).catch((err: unknown) => {
      this.logger.error(
        `pipeline failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    });
    if (!locked.acquired) {
      this.logger.log("skipped (another instance holds the lock)");
      return { status: "skipped_locked" };
    }
    return { status: "done", ...locked.value };
  }
}
