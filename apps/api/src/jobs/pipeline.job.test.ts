import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TEST_DATABASE_URL } from '@attn/core/testing';
import type { SourceReport } from '@attn/core';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Env } from '../config/env';
import { ENV, PIPELINE_STEPS } from '../tokens';
import { PipelineJob } from './pipeline.job';
import type { LabelStepResult, PipelineSteps } from './pipeline.steps';

const env: Env = {
  databaseUrl: TEST_DATABASE_URL,
  port: 0,
  labelModel: undefined,
  googleApiKey: undefined,
  scheduleEnabled: false,
};

const report: SourceReport = {
  sourceId: 's',
  status: 'ok',
  seen: 1,
  inserted: 1,
  duplicates: 0,
  tooOld: 0,
  skipped: 0,
};
const labelResult: LabelStepResult = {
  status: 'done',
  selected: 1,
  labeled: 1,
  failed: 0,
  rateLimited: false,
  items: [],
};

let errorLog: MockInstance;
beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function build(steps: PipelineSteps): Promise<PipelineJob> {
  const ref = await Test.createTestingModule({
    providers: [PipelineJob, { provide: ENV, useValue: env }, { provide: PIPELINE_STEPS, useValue: steps }],
  }).compile();
  return ref.get(PipelineJob);
}

function recording(over: Partial<PipelineSteps> = {}) {
  const order: string[] = [];
  const steps: PipelineSteps = {
    collect: async () => {
      order.push('collect');
      return [report];
    },
    label: async () => {
      order.push('label');
      return labelResult;
    },
    ...over,
  };
  return { order, steps };
}

describe('PipelineJob', () => {
  it('runs collect then label and returns both results', async () => {
    const { order, steps } = recording();
    const job = await build(steps);
    expect(await job.run()).toEqual({
      status: 'done',
      collect: [report],
      label: labelResult,
    });
    expect(order).toEqual(['collect', 'label']);
  });

  it('skips an overlapping run on the same job, then runs again after it finishes', async () => {
    const g = gate();
    const entered = gate();
    const { order, steps } = recording({
      collect: async () => {
        order.push('collect');
        entered.open();
        await g.promise;
        return [report];
      },
    });
    const job = await build(steps);
    const first = job.run();
    await entered.promise;
    expect(await job.run()).toEqual({ status: 'skipped_locked' });
    expect(order).toEqual(['collect']);
    g.open();
    expect((await first).status).toBe('done');
    expect((await job.run()).status).toBe('done');
    expect(order).toEqual(['collect', 'label', 'collect', 'label']);
  });

  it('two instances share the lock', async () => {
    const g = gate();
    const entered = gate();
    const a = recording({
      collect: async () => {
        entered.open();
        await g.promise;
        return [report];
      },
    });
    const b = recording();
    const jobA = await build(a.steps);
    const jobB = await build(b.steps);
    const runA = jobA.run();
    await entered.promise;
    expect(await jobB.run()).toEqual({ status: 'skipped_locked' });
    expect(b.order).toEqual([]);
    g.open();
    expect((await runA).status).toBe('done');
    expect((await jobB.run()).status).toBe('done');
  });

  it('a throwing label step rejects the run and frees the lock', async () => {
    let fail = true;
    const { steps } = recording({
      label: async () => {
        if (fail) throw new Error('label boom');
        return labelResult;
      },
    });
    const job = await build(steps);
    await expect(job.run()).rejects.toThrow('label boom');
    expect(errorLog).not.toHaveBeenCalled();
    fail = false;
    expect((await job.run()).status).toBe('done');
  });

  it('logs a fatal label error once at error level', async () => {
    const { steps } = recording({
      label: async () => ({ ...labelResult, fatal: 'provider rejected the request (401)' }),
    });
    const job = await build(steps);
    expect((await job.run()).status).toBe('done');
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0]![0])).toContain('provider rejected the request (401)');
  });

  it('a throwing collect step rejects the run, skips label and frees the lock', async () => {
    let fail = true;
    const { order, steps } = recording({
      collect: async () => {
        order.push('collect');
        if (fail) throw new Error('collect boom');
        return [report];
      },
    });
    const job = await build(steps);
    await expect(job.run()).rejects.toThrow('collect boom');
    expect(order).toEqual(['collect']);
    fail = false;
    expect((await job.run()).status).toBe('done');
  });
});
