import { Inject, Injectable, Logger } from '@nestjs/common';
import { PIPELINE_LOCK_KEY, withAdvisoryLock } from '@attn/core';
import type { SourceReport } from '@attn/core';
import type { Env } from '../config/env';
import { ENV, PIPELINE_STEPS } from '../tokens';
import type { LabelStepResult, PipelineSteps } from './pipeline.steps';

export type PipelineRunResult =
  | { status: 'skipped_locked' }
  | { status: 'done'; collect: SourceReport[]; label: LabelStepResult };

@Injectable()
export class PipelineJob {
  private readonly logger = new Logger(PipelineJob.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PIPELINE_STEPS) private readonly steps: PipelineSteps,
  ) {}

  async run(): Promise<PipelineRunResult> {
    const locked = await withAdvisoryLock(this.env.databaseUrl, PIPELINE_LOCK_KEY, async () => {
      this.logger.log('pipeline started');
      const collect = await this.steps.collect();
      for (const r of collect) {
        for (const f of r.filteredItems) this.logger.log(`filtered ${r.sourceId} ${f.rule} ${f.url}`);
      }
      const inserted = collect.reduce((n, r) => n + r.inserted, 0);
      const failed = collect.filter((r) => r.status === 'error').length;
      this.logger.log(`collect: ${collect.length} sources, ${inserted} inserted, ${failed} failed`);
      const label = await this.steps.label();
      if (label.status === 'done' && label.fatal) {
        this.logger.error(`label stopped: provider error: ${label.fatal}`);
      } else if (label.status === 'done') {
        this.logger.log(
          `label: ${label.labeled} labeled, ${label.excluded} excluded, ${label.failed} failed of ${label.selected}${label.rateLimited ? ' (rate limited)' : ''}`,
        );
      } else {
        this.logger.warn(`label skipped: ${label.reason}`);
      }
      return { collect, label };
    });
    if (!locked.acquired) {
      this.logger.log('skipped (another instance holds the lock)');
      return { status: 'skipped_locked' };
    }
    return { status: 'done', ...locked.value };
  }
}
