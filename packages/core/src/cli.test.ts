import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { articles } from './db/schema';
import { articleHtml } from './extract/fixtures/html';
import { createFakeLabeler, RateLimitError, type Labeler } from './label';
import { loadTaxonomy } from './data';
import type { Taxonomy } from '@attn/shared';
import type { Db } from './db/client';
import { readFixture } from './collect/fixtures/load';
import { startServer, type TestServer } from './test/server';
import { resetDb, TEST_DATABASE_URL, testDb } from './test/db';
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
