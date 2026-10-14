import { Logger, type INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { loadConfig } from '@attn/core';
import { TEST_DATABASE_URL } from '@attn/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Env } from '../config/env';
import { APP_CONFIG, ENV } from '../tokens';
import { PipelineJob, type PipelineRunResult } from './pipeline.job';
import { PipelineScheduler } from './pipeline.scheduler';
import { ScheduleModule } from '@nestjs/schedule';

const config = loadConfig();
const envWith = (scheduleEnabled: boolean): Env => ({
  databaseUrl: TEST_DATABASE_URL,
  port: 0,
  labelModel: undefined,
  googleApiKey: undefined,
  scheduleEnabled,
});

let errorLog: MockInstance;
beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(
  scheduleEnabled: boolean,
  run: () => Promise<PipelineRunResult> = async () => ({
    status: 'skipped_locked',
  }),
) {
  const ref = await Test.createTestingModule({
    imports: [ScheduleModule.forRoot()],
    providers: [
      PipelineScheduler,
      { provide: ENV, useValue: envWith(scheduleEnabled) },
      { provide: APP_CONFIG, useValue: config },
      { provide: PipelineJob, useValue: { run } },
    ],
  }).compile();
  app = ref.createNestApplication();
  await app.init();
  return {
    registry: ref.get(SchedulerRegistry),
    scheduler: ref.get(PipelineScheduler),
  };
}

describe('PipelineScheduler', () => {
  it('registers and starts the cron job from config when enabled', async () => {
    const { registry } = await start(true);
    const jobs = registry.getCronJobs();
    expect(jobs.has('pipeline')).toBe(true);
    const job = jobs.get('pipeline')!;
    expect(job.cronTime.source).toBe(config.schedule_cron);
    expect(job.isActive).toBe(true);
  });

  it('registers nothing when disabled', async () => {
    const { registry } = await start(false);
    expect(registry.getCronJobs().has('pipeline')).toBe(false);
  });

  it('tick never rejects', async () => {
    const failing = await start(true, async () => {
      throw new Error('nope');
    });
    await expect(failing.scheduler.tick()).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0]![0])).toContain('nope');
    await app!.close();
    const skipped = await start(true, async () => ({
      status: 'skipped_locked',
    }));
    await expect(skipped.scheduler.tick()).resolves.toBeUndefined();
  });

  it('closing the app stops the job', async () => {
    const { registry } = await start(true);
    const job = registry.getCronJobs().get('pipeline')!;
    await app!.close();
    app = undefined;
    expect(job.isActive).toBe(false);
  });
});
