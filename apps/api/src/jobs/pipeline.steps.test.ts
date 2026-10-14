import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { articles, createFakeLabeler, loadConfig, loadTaxonomy, type Db } from '@attn/core';
import { articleHtml, resetDb, startServer, testDb, type TestServer } from '@attn/core/testing';
import type { Source } from '@attn/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import { testEnv } from '../test/app';
import { ENV, PIPELINE_STEPS } from '../tokens';
import { PipelineJob } from './pipeline.job';
import { createPipelineSteps, labelerFromEnv } from './pipeline.steps';

const config = {
  ...loadConfig(),
  label_delay_ms: 0,
  label_min_chars: 200,
  label_max_chars: 1000,
  label_batch: 20,
  backfill_days: 365,
};
const taxonomy = loadTaxonomy();
const html = { headers: { 'content-type': 'text/html' } };

let db: Db;
let server: TestServer;
let sources: Source[];

beforeEach(async () => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  db = await testDb();
  await resetDb(db);
  server = await startServer();
  const pubDate = new Date(Date.now() - 864e5).toUTCString();
  const item = (n: number) =>
    `<item><title>Item ${n}</title><link>${server.baseUrl}/p${n}</link><guid>${server.baseUrl}/p${n}</guid><pubDate>${pubDate}</pubDate></item>`;
  server.setRoute('/feed.xml', {
    headers: { 'content-type': 'application/xml' },
    body: `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${item(1)}${item(2)}</channel></rss>`,
  });
  server.setRoute('/p1', { ...html, body: articleHtml('One', 400) });
  server.setRoute('/p2', { ...html, body: articleHtml('Two', 400) });
  sources = [
    {
      id: 'local',
      name: 'local',
      type: 'rss',
      url: `${server.baseUrl}/feed.xml`,
    },
  ];
});
afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
});

const deps = (over: Partial<Parameters<typeof createPipelineSteps>[0]> = {}) => ({
  db,
  sources,
  config,
  taxonomy,
  labeler: createFakeLabeler(),
  ...over,
});

describe('createPipelineSteps', () => {
  it('collect inserts pending articles', async () => {
    const reports = await createPipelineSteps(deps()).collect();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      sourceId: 'local',
      status: 'ok',
      inserted: 2,
    });
    const rows = await db.select().from(articles);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.labelStatus === 'pending')).toBe(true);
  });

  it('label labels the collected articles', async () => {
    const steps = createPipelineSteps(deps());
    await steps.collect();
    expect(await steps.label()).toMatchObject({ status: 'done', labeled: 2 });
    const rows = await db.select().from(articles);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.labelStatus).toBe('labeled');
      expect(r.labelModel).toBe('fake-model');
      expect(r.taxonomyVersion).toBe(taxonomy.version);
    }
  });

  it('end to end: one PipelineJob run collects then labels', async () => {
    const steps = createPipelineSteps(deps());
    const env: Env = testEnv();
    const ref = await Test.createTestingModule({
      providers: [PipelineJob, { provide: ENV, useValue: env }, { provide: PIPELINE_STEPS, useValue: steps }],
    }).compile();
    const result = await ref.get(PipelineJob).run();
    expect(result.status).toBe('done');
    const rows = await db.select().from(articles).where(eq(articles.labelStatus, 'labeled'));
    expect(rows).toHaveLength(2);
  });

  it('without a labeler the label step is skipped and articles stay pending', async () => {
    const steps = createPipelineSteps(deps({ labeler: null }));
    await steps.collect();
    const result = await steps.label();
    expect(result.status).toBe('skipped');
    expect(result.status === 'skipped' && result.reason).toContain('LABEL_MODEL');
    const rows = await db.select().from(articles);
    expect(rows.every((r) => r.labelStatus === 'pending')).toBe(true);
  });

  it('a failing source does not stop the others', async () => {
    const broken: Source = {
      id: 'broken',
      name: 'broken',
      type: 'rss',
      url: `${server.baseUrl}/missing.xml`,
    };
    const reports = await createPipelineSteps(deps({ sources: [broken, ...sources] })).collect();
    expect(reports.find((r) => r.sourceId === 'broken')?.status).toBe('error');
    expect(reports.find((r) => r.sourceId === 'local')).toMatchObject({
      status: 'ok',
      inserted: 2,
    });
    expect(await db.select().from(articles)).toHaveLength(2);
  });
});

describe('labelerFromEnv', () => {
  const keys = { googleApiKey: undefined, anthropicApiKey: undefined };

  it('is null without LABEL_MODEL or without the key of the chosen provider', () => {
    expect(labelerFromEnv({ ...keys, labelModel: undefined, googleApiKey: 'k', anthropicApiKey: 'k' }, taxonomy)).toBeNull();
    expect(labelerFromEnv({ ...keys, labelModel: 'claude-haiku-5-5', googleApiKey: 'k' }, taxonomy)).toBeNull();
    expect(labelerFromEnv({ ...keys, labelModel: 'gemini-3.6-flash', anthropicApiKey: 'k' }, taxonomy)).toBeNull();
  });

  it('builds the labeler of the provider named by the model prefix', () => {
    expect(labelerFromEnv({ ...keys, labelModel: 'claude-haiku-5-5', anthropicApiKey: 'k' }, taxonomy)?.model).toBe(
      'claude-haiku-5-5',
    );
    expect(labelerFromEnv({ ...keys, labelModel: 'gemini-3.6-flash', googleApiKey: 'k' }, taxonomy)?.model).toBe(
      'gemini-3.6-flash',
    );
  });

  it('throws at startup on an unknown provider prefix', () => {
    expect(() => labelerFromEnv({ labelModel: 'gpt-5', googleApiKey: 'k', anthropicApiKey: 'k' }, taxonomy)).toThrow(
      /unknown LABEL_MODEL provider/,
    );
  });
});
