import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LabelOutput } from '@attn/shared';
import { articleHtml } from '../extract/fixtures/html';
import { loadTaxonomy } from '../data';
import { createFakeLabeler, FatalLabelerError, OverloadedError, RateLimitError } from '../label';
import { startServer, type TestServer } from '../test/server';
import { createTextCache } from './cache';
import { readEvalFixture } from './fixtures/load';
import { registerScenarioRoutes, scenarioLabeler } from './fixtures/scenario';
import { loadGolden } from './golden';
import { formatEvalReport } from './score';
import { runEval } from './run';

const config = { label_max_chars: 1000, label_min_chars: 200, label_delay_ms: 10, label_overload_backoff_ms: [2000, 5000] };
const ANY: LabelOutput = { primary_skill: 'cc-hooks', secondary_skills: [], difficulty: 1, type: 'news', quality: 1 };
const html = { headers: { 'Content-Type': 'text/html' } };
let server: TestServer;
let tmp: string;
let sleeps: number[];
const sleep = async (ms: number) => void sleeps.push(ms);

const golden = () => loadGolden(tmp, loadTaxonomy());
const cache = () => createTextCache(path.join(tmp, 'cache'));

beforeEach(async () => {
  server = await startServer();
  registerScenarioRoutes(server);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'attn-eval-'));
  fs.mkdirSync(path.join(tmp, 'golden'));
  fs.writeFileSync(path.join(tmp, 'golden', 'g.yml'), readEvalFixture('golden.yml', server.baseUrl));
  sleeps = [];
});
afterEach(async () => {
  await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('runEval', () => {
  it('scores the pinned scenario', async () => {
    const r = await runEval({ labeler: scenarioLabeler(), golden: golden(), cache: cache(), config, sleep });
    expect(r.model).toBe('fake-model');
    expect(r.total).toBe(4);
    expect(r.evaluated).toBe(3);
    expect(r.rateLimited).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]!.url).toBe(`${server.baseUrl}/g4`);
    expect(r.failures[0]!.error).toContain('404');
    expect(r.metrics!.primary_skill).toBeCloseTo(2 / 3);
    expect(r.metrics!.secondary_skills).toBeCloseTo(2.5 / 3);
    expect(r.metrics!.difficulty_exact).toBeCloseTo(2 / 3);
    expect(r.metrics!.difficulty_within1).toBeCloseTo(1);
    expect(r.metrics!.type).toBeCloseTo(2 / 3);
    expect(r.metrics!.quality_within1).toBeCloseTo(2 / 3);
    const fieldsOf = (n: number) =>
      r.disagreements.filter((d) => d.url === `${server.baseUrl}/g${n}`).map((d) => d.field);
    expect(fieldsOf(1)).toEqual(['secondary_skills', 'difficulty']);
    expect(fieldsOf(2)).toEqual(['primary_skill', 'type', 'quality']);
    expect(fieldsOf(3)).toEqual([]);
  });

  it('reuses cached text across runs and labelers', async () => {
    const c = cache();
    const labeler = scenarioLabeler();
    await runEval({ labeler, golden: golden(), cache: c, config, sleep });
    await runEval({ labeler, golden: golden(), cache: c, config, sleep });
    for (const p of ['/g1', '/g2', '/g3']) expect(server.hits(p)).toBe(1);
    expect(labeler.calls).toHaveLength(6);
    expect(labeler.calls[0]!.text).toBe(labeler.calls[3]!.text);

    const other = scenarioLabeler('other');
    const r = await runEval({ labeler: other, golden: golden(), cache: c, config, sleep });
    expect(r.model).toBe('other');
    expect(other.calls[0]!.text).toBe(labeler.calls[0]!.text);
    for (const p of ['/g1', '/g2', '/g3']) expect(server.hits(p)).toBe(1);
  });

  it('applies the production text rules', async () => {
    const labeler = scenarioLabeler();
    server.setRoute('/g2', { ...html, body: articleHtml('Short', 10) });
    const r = await runEval({ labeler, golden: golden(), cache: cache(), config, sleep });
    expect(labeler.calls.map((c) => c.text.length)).toEqual([1000, 1000]);
    const f = r.failures.find((x) => x.url === `${server.baseUrl}/g2`);
    expect(f!.error.startsWith('text too short:')).toBe(true);
    expect(labeler.calls.some((c) => c.url.endsWith('/g2'))).toBe(false);
  });

  it('stops on a rate limit', async () => {
    const labeler = createFakeLabeler((_a, i) => {
      if (i === 1) throw new RateLimitError('429');
      return ANY;
    });
    const r = await runEval({ labeler, golden: golden(), cache: cache(), config, sleep });
    expect(r.rateLimited).toBe(true);
    expect(r.evaluated).toBe(1);
    expect(server.hits('/g3')).toBe(0);
    expect(formatEvalReport(r)).toContain('rate limited');
  });

  it('retries a provider overload with the configured backoff', async () => {
    const labeler = createFakeLabeler((_a, i) => {
      if (i === 0) throw new OverloadedError('provider overloaded (503)');
      return ANY;
    });
    const r = await runEval({ labeler, golden: golden(), cache: cache(), config, sleep });
    expect(r.evaluated).toBe(3);
    expect(r.failures.map((f) => f.url)).toEqual([`${server.baseUrl}/g4`]); // g4 is the fixture's 404
    expect(sleeps).toEqual([2000, 10, 10]);
  });

  it('records an article as failed after the overload retries and continues', async () => {
    const labeler = createFakeLabeler((a) => {
      if (a.url.endsWith('/g1')) throw new OverloadedError('provider overloaded (503)');
      return ANY;
    });
    const r = await runEval({ labeler, golden: golden(), cache: cache(), config, sleep });
    expect(labeler.calls.filter((c) => c.url.endsWith('/g1'))).toHaveLength(3);
    expect(r.failures.find((f) => f.url === `${server.baseUrl}/g1`)!.error).toMatch(/overloaded.*2 retries/);
    expect(r.evaluated).toBe(2);
    expect(r.rateLimited).toBe(false);
    expect(sleeps).toEqual([2000, 5000, 10, 10]);
  });

  it('stops on a fatal provider error and reports it', async () => {
    const labeler = createFakeLabeler((_a, i) => {
      if (i === 1) throw new FatalLabelerError('provider rejected the request (404)');
      return ANY;
    });
    const r = await runEval({ labeler, golden: golden(), cache: cache(), config, sleep });
    expect(r.fatal).toBe('provider rejected the request (404)');
    expect(r.evaluated).toBe(1);
    expect(r.failures).toEqual([]);
    expect(server.hits('/g3')).toBe(0);
    expect(formatEvalReport(r)).toContain('provider error: provider rejected the request (404)');
  });

  it('records other labeler errors as failures and continues', async () => {
    const labeler = createFakeLabeler((_a, i) => {
      if (i === 0) throw new Error('boom');
      return ANY;
    });
    const r = await runEval({ labeler, golden: golden(), cache: cache(), config, sleep });
    expect(r.failures.find((f) => f.url === `${server.baseUrl}/g1`)!.error).toBe('boom');
    expect(r.evaluated).toBe(2);
    expect(r.rateLimited).toBe(false);
  });

  it('reports the labeler token usage at the end of the run when the labeler exposes it', async () => {
    const usage = { inputTokens: 1822, outputTokens: 12, cacheReadTokens: 900, cacheWriteTokens: 900 };
    const labeler = { ...scenarioLabeler(), usage: () => usage };
    const r = await runEval({ labeler, golden: golden(), cache: cache(), config, sleep });
    expect(r.usage).toEqual(usage);
    const lines = formatEvalReport(r).split('\n');
    expect(lines.at(-1)).toBe('tokens: input=1822 output=12 cache_read=900 cache_write=900');
  });

  it('prints no token line for a labeler without usage', async () => {
    const r = await runEval({ labeler: scenarioLabeler(), golden: golden(), cache: cache(), config, sleep });
    expect(r.usage).toBeUndefined();
    expect(formatEvalReport(r)).not.toContain('tokens:');
  });

  it('sleeps before every labeler call except the first, cached or not', async () => {
    const c = cache();
    await runEval({ labeler: scenarioLabeler(), golden: golden(), cache: c, config, sleep });
    expect(sleeps).toEqual([10, 10]);
    sleeps = [];
    await runEval({ labeler: scenarioLabeler(), golden: golden(), cache: c, config, sleep });
    expect(sleeps).toEqual([10, 10]);
  });
});

describe('eval/ is DB-free', () => {
  it('has no db/pipeline/drizzle/postgres imports in non-test sources', () => {
    const files = fs.readdirSync(import.meta.dirname).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = fs.readFileSync(path.join(import.meta.dirname, f), 'utf8');
      expect(src, f).not.toMatch(/(\/db|\/pipeline|drizzle-orm|postgres)['"]/);
    }
  });
});
