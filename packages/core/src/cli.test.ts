import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { articles } from './db/schema';
import { PIPELINE_LOCK_KEY, withAdvisoryLock } from './db/lock';
import { articleHtml } from './extract/fixtures/html';
import { createFakeLabeler, FatalLabelerError, RateLimitError, type Labeler } from './label';
import { loadTaxonomy } from './data';
import type { Taxonomy } from '@attn/shared';
import type { Db } from './db/client';
import { readFixture } from './collect/fixtures/load';
import { startServer, type TestServer } from './test/server';
import { resetDb, TEST_DATABASE_URL, testDb } from './test/db';
import { readEvalFixture } from './eval/fixtures/load';
import { registerScenarioRoutes, scenarioLabeler } from './eval/fixtures/scenario';
import { resolveLabelerFactory, run } from './cli';

const deps = { now: new Date('2026-10-14T12:00:00Z') };

let db: Db;
let server: TestServer;
let tmp: string;
let env: NodeJS.ProcessEnv;
let out: string[];
let err: string[];
const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };

beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
  server = await startServer();
  server.setRoute('/rss.xml', {
    headers: { 'Content-Type': 'application/xml' },
    body: readFixture('rss.xml', server.baseUrl),
  });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'attn-cli-'));
  fs.writeFileSync(
    path.join(tmp, 'sources.yml'),
    `- id: local-feed\n  name: Local feed\n  type: rss\n  url: ${server.baseUrl}/rss.xml\n`,
  );
  fs.copyFileSync(path.resolve(import.meta.dirname, '../../../data/config.yml'), path.join(tmp, 'config.yml'));
  env = { DATABASE_URL: TEST_DATABASE_URL, ATTN_DATA_DIR: tmp };
  out = [];
  err = [];
});
afterEach(async () => {
  await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('attn collect', () => {
  it('collects and prints a line per source plus totals', async () => {
    expect(await run(['collect'], env, io, deps)).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('local-feed');
    expect(text).toContain('inserted=4');
    expect(text).toContain('total:');
    expect(await db.select().from(articles)).toHaveLength(4);
  });

  it('rejects an unknown --source', async () => {
    expect(await run(['collect', '--source', 'nope'], env, io, deps)).toBe(1);
    expect(err.join('\n')).toContain('nope');
  });

  it('fails without DATABASE_URL', async () => {
    expect(await run(['collect'], { ATTN_DATA_DIR: tmp }, io, deps)).toBe(1);
    expect(err.join('\n')).toContain('DATABASE_URL');
  });

  it('honors --backfill-days', async () => {
    expect(await run(['collect', '--backfill-days', '10'], env, io, deps)).toBe(0);
    expect(out.join('\n')).toContain('inserted=3');
    expect((await db.select().from(articles)).map((a) => a.title).sort()).toEqual(['First post', 'Future', 'Undated']);
  });

  it.each(['0', 'abc', '3651', '99999999999999999999'])('rejects --backfill-days %s', async (v) => {
    expect(await run(['collect', '--backfill-days', v], env, io, deps)).toBe(1);
    expect(err.join('\n')).toContain('--backfill-days');
  });
});

describe('pipeline lock', () => {
  async function whileLocked(fn: () => Promise<void>) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => (entered = resolve));
    const holder = withAdvisoryLock(TEST_DATABASE_URL, PIPELINE_LOCK_KEY, async () => {
      entered();
      await held;
    });
    await ready;
    try {
      await fn();
    } finally {
      release();
      await holder;
    }
  }

  it('collect exits 1 without touching the database while the lock is held', async () => {
    await whileLocked(async () => {
      expect(await run(['collect'], env, io, deps)).toBe(1);
    });
    expect(err.join('\n')).toContain('another collect/label run is in progress');
    expect(out).toEqual([]);
    expect(await db.select().from(articles)).toHaveLength(0);
    expect(await run(['collect'], env, io, deps)).toBe(0);
  });

  it('label exits 1 while the lock is held', async () => {
    fs.copyFileSync(path.resolve(import.meta.dirname, '../../../data/taxonomy.yml'), path.join(tmp, 'taxonomy.yml'));
    const labelEnv = { ...env, LABEL_MODEL: 'fake-model' };
    const withFake = { ...deps, sleep: async () => {}, makeLabeler: () => createFakeLabeler() };
    await whileLocked(async () => {
      expect(await run(['label'], labelEnv, io, withFake)).toBe(1);
    });
    expect(err.join('\n')).toContain('another collect/label run is in progress');
    expect(await run(['label'], labelEnv, io, withFake)).toBe(0);
  });
});

describe('attn migrate', () => {
  it('is idempotent', async () => {
    expect(await run(['migrate'], env, io)).toBe(0);
    expect(await run(['migrate'], env, io)).toBe(0);
  });
});

it('unknown command prints usage', async () => {
  expect(await run(['frobnicate'], env, io)).toBe(1);
  expect(err.join('\n')).toContain('migrate | collect');
});

describe('attn label', () => {
  const html = { headers: { 'content-type': 'text/html' } };
  let labelEnv: NodeJS.ProcessEnv;
  const labelDeps = { ...deps, sleep: async () => {} };
  const dataSrc = path.resolve(import.meta.dirname, '../../../data');

  beforeEach(() => {
    fs.copyFileSync(path.join(dataSrc, 'taxonomy.yml'), path.join(tmp, 'taxonomy.yml'));
    const cfg = fs
      .readFileSync(path.join(dataSrc, 'config.yml'), 'utf8')
      .replace(/^label_min_chars:.*$/m, 'label_min_chars: 200')
      .replace(/^label_max_chars:.*$/m, 'label_max_chars: 1000')
      .replace(/^label_batch:.*$/m, 'label_batch: 20');
    fs.writeFileSync(path.join(tmp, 'config.yml'), cfg);
    labelEnv = { ...env, LABEL_MODEL: 'fake-model' };
  });

  async function seed(n: number, served = true) {
    if (served) server.setRoute(`/p${n}`, { ...html, body: articleHtml(`Title ${n}`, 400) });
    await db.insert(articles).values({
      sourceId: 's',
      url: `${server.baseUrl}/p${n}`,
      guid: `g${n}`,
      title: `Title ${n}`,
      titleHash: `h${n}`,
      publishedAt: new Date(`2026-01-0${n}T00:00:00Z`),
    });
  }
  const statuses = async () => (await db.select().from(articles).orderBy(articles.id)).map((a) => a.labelStatus);
  const withFake = { ...labelDeps, makeLabeler: () => createFakeLabeler() };

  it('labels pending articles and prints lines and totals', async () => {
    await seed(1);
    await seed(2);
    expect(await run(['label'], labelEnv, io, withFake)).toBe(0);
    expect(out.filter((l) => l.startsWith('labeled  '))).toHaveLength(2);
    expect(out).toContain('total: selected=2 labeled=2 failed=0 rate_limited=no');
    expect(await statuses()).toEqual(['labeled', 'labeled']);
  });

  it('passes LABEL_MODEL and the taxonomy to makeLabeler', async () => {
    let got: { model: string; taxonomy: Taxonomy } | undefined;
    const makeLabeler = (model: string, taxonomy: Taxonomy): Labeler => {
      got = { model, taxonomy };
      return createFakeLabeler();
    };
    expect(await run(['label'], labelEnv, io, { ...labelDeps, makeLabeler })).toBe(0);
    expect(got?.model).toBe('fake-model');
    expect(got?.taxonomy.domains.length).toBeGreaterThan(0);
  });

  it('fails without LABEL_MODEL and changes nothing', async () => {
    await seed(1);
    const noModel = { ...labelEnv, LABEL_MODEL: undefined };
    expect(await run(['label'], noModel, io, withFake)).toBe(1);
    expect(err.join('\n')).toContain('LABEL_MODEL');
    expect(await statuses()).toEqual(['pending']);
  });

  it('fails without an API key when no makeLabeler is injected', async () => {
    expect(await run(['label'], labelEnv, io, labelDeps)).toBe(1);
    expect(err.join('\n')).toContain('GOOGLE_GENERATIVE_AI_API_KEY');
  });

  it('fails without DATABASE_URL', async () => {
    expect(await run(['label'], { ATTN_DATA_DIR: tmp, LABEL_MODEL: 'fake-model' }, io, withFake)).toBe(1);
    expect(err.join('\n')).toContain('DATABASE_URL');
  });

  it('honors --limit', async () => {
    await seed(1);
    await seed(2);
    expect(await run(['label', '--limit', '1'], labelEnv, io, withFake)).toBe(0);
    expect(out.join('\n')).toContain('selected=1');
    expect(await statuses()).toEqual(['labeled', 'pending']);
  });

  it.each(['0', 'abc', '-1', '1.5'])('rejects --limit %s', async (v) => {
    expect(await run(['label', '--limit', v], labelEnv, io, withFake)).toBe(1);
    expect(err.join('\n')).toContain('--limit');
  });

  it('reports a rate limit and leaves the article pending', async () => {
    await seed(1);
    const makeLabeler = () =>
      createFakeLabeler(() => {
        throw new RateLimitError('429');
      });
    expect(await run(['label'], labelEnv, io, { ...labelDeps, makeLabeler })).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('rate_limited  ');
    expect(text).toContain('rate_limited=yes');
    expect(text).toContain('the remaining articles stay pending for the next run');
    expect(await statuses()).toEqual(['pending']);
  });

  it('exits 1 on a fatal provider error and leaves the article untouched', async () => {
    await seed(1);
    const makeLabeler = () =>
      createFakeLabeler(() => {
        throw new FatalLabelerError('provider rejected the request (401)');
      });
    expect(await run(['label'], labelEnv, io, { ...labelDeps, makeLabeler })).toBe(1);
    expect(err.join('\n')).toContain('provider error: provider rejected the request (401)');
    expect(out.join('\n')).toContain('selected=1 labeled=0 failed=0');
    const [row] = await db.select().from(articles);
    expect([row!.labelStatus, row!.labelAttempts]).toEqual(['pending', 0]);
  });

  it('shows a failed article with its error', async () => {
    await seed(1, false);
    expect(await run(['label'], labelEnv, io, withFake)).toBe(0);
    expect(out.join('\n')).toMatch(/failed {2}\S+\/p1 {2}HTTP 404/);
    expect(out.join('\n')).toContain('failed=1');
  });

  it('rejects an unknown flag', async () => {
    expect(await run(['label', '--bogus'], labelEnv, io, withFake)).toBe(1);
  });
});

describe('attn eval', () => {
  const dataSrc = path.resolve(import.meta.dirname, '../../../data');
  const evalDeps = { ...deps, sleep: async () => {}, makeLabeler: (model: string) => scenarioLabeler(model) };
  let evalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    fs.copyFileSync(path.join(dataSrc, 'taxonomy.yml'), path.join(tmp, 'taxonomy.yml'));
    const cfg = fs
      .readFileSync(path.join(dataSrc, 'config.yml'), 'utf8')
      .replace(/^label_min_chars:.*$/m, 'label_min_chars: 200')
      .replace(/^label_max_chars:.*$/m, 'label_max_chars: 1000')
      .replace(/^label_delay_ms:.*$/m, 'label_delay_ms: 1');
    fs.writeFileSync(path.join(tmp, 'config.yml'), cfg);
    fs.mkdirSync(path.join(tmp, 'golden'));
    fs.writeFileSync(path.join(tmp, 'golden', 'g.yml'), readEvalFixture('golden.yml', server.baseUrl));
    registerScenarioRoutes(server);
    evalEnv = { ATTN_DATA_DIR: tmp, ATTN_CACHE_DIR: path.join(tmp, 'cache') };
  });

  function expectFullReport(model = 'fake-model') {
    const text = out.join('\n');
    expect(text).toContain(`model: ${model}`);
    expect(text).toContain('articles: evaluated=3 of 4 failed=1');
    expect(text).toContain('primary_skill'.padEnd(20) + '66.7%');
    expect(text).toContain('failed:');
  }

  it('prints the report and exits 0', async () => {
    expect(await run(['eval', '--model', 'fake-model'], evalEnv, io, evalDeps)).toBe(0);
    expectFullReport();
  });

  it('passes the model and taxonomy to makeLabeler', async () => {
    let got: { model: string; taxonomy: Taxonomy } | undefined;
    const makeLabeler = (model: string, taxonomy: Taxonomy) => {
      got = { model, taxonomy };
      return scenarioLabeler(model);
    };
    expect(await run(['eval', '--model', 'fake-model'], evalEnv, io, { ...evalDeps, makeLabeler })).toBe(0);
    expect(got?.model).toBe('fake-model');
    expect(got?.taxonomy.domains.length).toBeGreaterThan(0);
  });

  it('never touches the database, even when DATABASE_URL is unreachable', async () => {
    await db.insert(articles).values({
      sourceId: 's',
      url: 'https://example.com/seed',
      guid: 'seed',
      title: 'Seed',
      titleHash: 'hseed',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const before = await db.select().from(articles);

    expect(await run(['eval', '--model', 'fake-model'], evalEnv, io, evalDeps)).toBe(0);
    expectFullReport();

    out.length = 0;
    fs.rmSync(path.join(tmp, 'cache'), { recursive: true, force: true });
    const unreachable = { ...evalEnv, DATABASE_URL: 'postgres://x:x@127.0.0.1:1/none' };
    expect(await run(['eval', '--model', 'fake-model'], unreachable, io, evalDeps)).toBe(0);
    expectFullReport();

    expect(await db.select().from(articles)).toEqual(before);
  });

  it('reuses cached text for a second model', async () => {
    expect(await run(['eval', '--model', 'fake-model'], evalEnv, io, evalDeps)).toBe(0);
    out.length = 0;
    const makeLabeler = (model: string) => scenarioLabeler(model);
    expect(await run(['eval', '--model', 'other-model'], evalEnv, io, { ...evalDeps, makeLabeler })).toBe(0);
    expectFullReport('other-model');
    expect(server.hits('/g1')).toBe(1);
  });

  it('requires --model', async () => {
    expect(await run(['eval'], evalEnv, io, evalDeps)).toBe(1);
    expect(err.join('\n')).toContain('--model');
    expect(server.hits('/g1')).toBe(0);
  });

  it('fails on an empty golden set', async () => {
    fs.rmSync(path.join(tmp, 'golden'), { recursive: true });
    expect(await run(['eval', '--model', 'm'], evalEnv, io, evalDeps)).toBe(1);
    expect(err.join('\n')).toContain(`no golden items found in ${tmp}/golden; see README "Evaluation"`);
  });

  it('fails without an API key when no makeLabeler is injected', async () => {
    expect(await run(['eval', '--model', 'm'], evalEnv, io, { ...deps, sleep: async () => {} })).toBe(1);
    expect(err.join('\n')).toContain('GOOGLE_GENERATIVE_AI_API_KEY');
  });

  it('exits 1 with the partial report on a rate limit', async () => {
    const makeLabeler = () =>
      createFakeLabeler(() => {
        throw new RateLimitError('429');
      });
    expect(await run(['eval', '--model', 'm'], evalEnv, io, { ...evalDeps, makeLabeler })).toBe(1);
    expect(out.join('\n')).toContain('model:');
    expect(err.join('\n')).toContain('rate limited by the provider; evaluation is incomplete');
  });

  it('exits 1 with the partial report on a fatal provider error', async () => {
    const makeLabeler = () =>
      createFakeLabeler(() => {
        throw new FatalLabelerError('provider rejected the request (404)');
      });
    expect(await run(['eval', '--model', 'm'], evalEnv, io, { ...evalDeps, makeLabeler })).toBe(1);
    expect(out.join('\n')).toContain('model:');
    expect(err.join('\n')).toContain('provider error: provider rejected the request (404)');
  });

  it('exits 1 when nothing could be scored', async () => {
    const makeLabeler = () =>
      createFakeLabeler(() => {
        throw new Error('boom');
      });
    expect(await run(['eval', '--model', 'm'], evalEnv, io, { ...evalDeps, makeLabeler })).toBe(1);
    expect(out.join('\n')).toContain('evaluated=0 of 4 failed=4');
    expect(err.join('\n')).toContain('no article could be evaluated');
  });

  it('rejects a repeated --model and unknown flags', async () => {
    expect(await run(['eval', '--model', 'a', '--model', 'b'], evalEnv, io, evalDeps)).toBe(1);
    expect(await run(['eval', '--model', 'a', '--bogus'], evalEnv, io, evalDeps)).toBe(1);
  });

  it('evalCommand source has no database access', () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, 'cli.ts'), 'utf8');
    const start = src.indexOf('async function evalCommand');
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start + 1);
    const next = rest.search(/\n(export )?async function /);
    const body = src.slice(start, next === -1 ? undefined : start + 1 + next);
    expect(body).not.toContain('createDb');
    expect(body).not.toContain('DATABASE_URL');
  });
});

describe('resolveLabelerFactory', () => {
  const taxonomy = loadTaxonomy();

  it('returns deps.makeLabeler unchanged', () => {
    const makeLabeler = () => createFakeLabeler();
    expect(resolveLabelerFactory({}, { makeLabeler })).toBe(makeLabeler);
  });

  it('returns an error naming the key when neither is available', () => {
    for (const e of [{}, { GOOGLE_GENERATIVE_AI_API_KEY: '' }]) {
      const r = resolveLabelerFactory(e, {});
      expect(typeof r).toBe('object');
      expect((r as { error: string }).error).toContain('GOOGLE_GENERATIVE_AI_API_KEY');
    }
  });

  it('builds a gemini labeler from the key without network', () => {
    const r = resolveLabelerFactory({ GOOGLE_GENERATIVE_AI_API_KEY: 'k' }, {});
    expect(typeof r).toBe('function');
    expect((r as (m: string, t: Taxonomy) => Labeler)('gemini-3.6-flash', taxonomy).model).toBe('gemini-3.6-flash');
  });
});

describe('attn seed-demo', () => {
  beforeEach(() => {
    fs.copyFileSync(path.resolve(import.meta.dirname, '../../../data/taxonomy.yml'), path.join(tmp, 'taxonomy.yml'));
  });

  it('inserts, is idempotent, and removes', async () => {
    expect(await run(['seed-demo'], env, io, deps)).toBe(0);
    expect(out).toContain('demo articles: inserted=160');
    expect(await run(['seed-demo'], env, io, deps)).toBe(0);
    expect(out).toContain('demo articles: inserted=0');
    expect(await run(['seed-demo', '--remove'], env, io, deps)).toBe(0);
    expect(out).toContain('demo articles: removed=160');
    expect(await db.select().from(articles)).toHaveLength(0);
  });

  it('takes no pipeline lock', async () => {
    const r = await withAdvisoryLock(TEST_DATABASE_URL, PIPELINE_LOCK_KEY, () => run(['seed-demo'], env, io, deps));
    expect(r.acquired && r.value).toBe(0);
  });

  it('fails without DATABASE_URL', async () => {
    expect(await run(['seed-demo'], { ATTN_DATA_DIR: tmp }, io, deps)).toBe(1);
    expect(err.join('\n')).toContain('DATABASE_URL is not set');
  });

  it('is listed in the usage', async () => {
    await run([], env, io);
    expect(err.join('\n')).toContain('seed-demo');
  });
});
