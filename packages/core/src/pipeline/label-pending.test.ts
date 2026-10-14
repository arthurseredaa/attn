import { eq, getTableColumns, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { articleSkills, articles, type Db } from '../db';
import { articleHtml } from '../extract/fixtures/html';
import { createFakeLabeler, FatalLabelerError, OverloadedError, RateLimitError } from '../label';
import { resetDb, testDb } from '../test/db';
import { startServer, type TestServer } from '../test/server';
import { labelPending, type LabelOptions } from './label-pending';

const config = {
  label_batch: 2,
  label_delay_ms: 25,
  label_max_chars: 1000,
  label_min_chars: 200,
  label_max_attempts: 3,
  label_overload_backoff_ms: [2000, 5000, 10000],
};
const now = new Date('2026-10-14T12:00:00Z');
const html = { headers: { 'content-type': 'text/html' } };

let db: Db;
let server: TestServer;
let sleeps: number[];

beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
  sleeps = [];
  server = await startServer();
});
afterEach(async () => {
  await server.close();
});

function page(n: number | string, body?: string) {
  server.setRoute(`/p${n}`, { ...html, body: body ?? articleHtml(`Title ${n}`, 400) });
}

async function insertArticle(n: number | string, over: Partial<typeof articles.$inferInsert> = {}, served = true) {
  if (served) page(n);
  const [row] = await db
    .insert(articles)
    .values({
      sourceId: 's',
      url: `${server.baseUrl}/p${n}`,
      guid: `g${n}`,
      title: `Title ${n}`,
      titleHash: `h${n}`,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      ...over,
    })
    .returning();
  return row!;
}

const getRow = async (id: number) => (await db.select().from(articles).where(eq(articles.id, id)))[0]!;

function run(labeler: LabelOptions['labeler'], over: Partial<LabelOptions> = {}) {
  return labelPending({
    db,
    labeler,
    config,
    taxonomyVersion: 7,
    now,
    sleep: async (ms) => void sleeps.push(ms),
    ...over,
  });
}

describe('labelPending', () => {
  it('labels oldest first up to the batch size', async () => {
    const a = await insertArticle(1, { publishedAt: new Date('2026-01-03T00:00:00Z') });
    const b = await insertArticle(2, { publishedAt: new Date('2026-01-01T00:00:00Z') });
    const c = await insertArticle(3, { publishedAt: new Date('2026-01-02T00:00:00Z') });
    const report = await run(createFakeLabeler());
    expect(report.selected).toBe(2);
    expect(report.labeled).toBe(2);
    expect((await getRow(a.id)).labelStatus).toBe('pending');
    expect((await getRow(b.id)).labelStatus).toBe('labeled');
    expect((await getRow(c.id)).labelStatus).toBe('labeled');
  });

  it('writes label fields and normalized skills', async () => {
    const a = await insertArticle(1);
    const labeler = createFakeLabeler(
      () => ({
        primary_skill: 'cc-hooks',
        secondary_skills: ['cc-plugins', 'cc-hooks', 'cc-plugins'],
        difficulty: 3,
        type: 'deep_dive',
        quality: 4,
      }),
      'fake-m',
    );
    await run(labeler);
    const row = await getRow(a.id);
    expect(row).toMatchObject({
      labelStatus: 'labeled',
      difficulty: 3,
      type: 'deep_dive',
      quality: 4,
      labelModel: 'fake-m',
      taxonomyVersion: 7,
    });
    expect(row.labeledAt).toEqual(now);
    expect(row.wordCount).toBeGreaterThanOrEqual(395);
    expect(row.wordCount).toBeLessThanOrEqual(410);
    const skills = await db.select().from(articleSkills).where(eq(articleSkills.articleId, a.id));
    expect(skills.map((s) => [s.skillId, s.isPrimary]).sort()).toEqual([
      ['cc-hooks', true],
      ['cc-plugins', false],
    ]);
  });

  it('truncates for the labeler and stores no text', async () => {
    const a = await insertArticle(1);
    const labeler = createFakeLabeler();
    await run(labeler);
    expect(labeler.calls[0]!.text.length).toBe(1000);
    expect(Object.keys(labeler.calls[0]!).sort()).toEqual(['text', 'title', 'url']);
    expect(labeler.calls[0]!.title).toBe('Title 1');
    const row = await getRow(a.id);
    expect(row.wordCount).toBeGreaterThan(300);
    expect(Object.keys(row).sort()).toEqual(Object.keys(getTableColumns(articles)).sort());
    for (const table of ['articles', 'article_skills', 'source_state']) {
      const rows = await db.execute<{ j: string }>(sql`select row_to_json(t)::text as j from ${sql.identifier(table)} t`);
      for (const r of rows) expect(r.j).not.toContain('w399');
    }
  });

  it('fails too-short text, keeps word count, skips the labeler', async () => {
    const a = await insertArticle(1);
    page(1, articleHtml('S', 10));
    const labeler = createFakeLabeler();
    const report = await run(labeler);
    const row = await getRow(a.id);
    expect(row.labelStatus).toBe('failed');
    expect(row.labelAttempts).toBe(1);
    expect(labeler.calls).toHaveLength(0);
    expect(report.items[0]!.outcome).toBe('failed');
    expect(report.items[0]!.error).toMatch(/^text too short:/);
    expect(row.wordCount).toBeGreaterThanOrEqual(8);
    expect(row.wordCount).toBeLessThanOrEqual(14);
  });

  it('fails on HTTP 404 and non-HTML', async () => {
    const a = await insertArticle(1, {}, false);
    const b = await insertArticle(2, {}, false);
    server.setRoute('/p2', { headers: { 'content-type': 'application/pdf' }, body: '%PDF' });
    const labeler = createFakeLabeler();
    await run(labeler);
    for (const id of [a.id, b.id]) {
      const row = await getRow(id);
      expect(row.labelStatus).toBe('failed');
      expect(row.labelAttempts).toBe(1);
    }
    expect(labeler.calls).toHaveLength(0);
  });

  it('treats network errors as per-article failures', async () => {
    const a = await insertArticle(1, {}, false);
    const b = await insertArticle(2);
    const fetchFn = ((url: string | URL | Request, init?: RequestInit) =>
      String(url).endsWith('/p1') ? Promise.reject(new TypeError('fetch failed')) : fetch(url, init)) as typeof fetch;
    const report = await run(createFakeLabeler(), { fetchFn });
    expect((await getRow(a.id)).labelStatus).toBe('failed');
    expect((await getRow(b.id)).labelStatus).toBe('labeled');
    expect(report.items[0]!.error).toBe('fetch failed');
  });

  it('caps retries and does not increment on success', async () => {
    const a = await insertArticle(1, {}, false);
    for (const attempts of [1, 2, 3]) {
      await run(createFakeLabeler());
      const row = await getRow(a.id);
      expect([row.labelStatus, row.labelAttempts]).toEqual(['failed', attempts]);
    }
    const report = await run(createFakeLabeler());
    expect(report.selected).toBe(0);
    expect(server.hits('/p1')).toBe(3);

    const b = await insertArticle(2, { labelStatus: 'failed', labelAttempts: 1 });
    await run(createFakeLabeler());
    const row = await getRow(b.id);
    expect([row.labelStatus, row.labelAttempts]).toEqual(['labeled', 1]);
  });

  it('isolates a labeler error', async () => {
    const a = await insertArticle(1, { publishedAt: new Date('2026-01-01T00:00:00Z') });
    const b = await insertArticle(2, { publishedAt: new Date('2026-01-02T00:00:00Z') });
    const labeler = createFakeLabeler((_, i) => {
      if (i === 0) throw new Error('boom');
      return { primary_skill: 'cc-hooks', secondary_skills: [], difficulty: 1, type: 'news', quality: 1 };
    });
    const report = await run(labeler);
    const ra = await getRow(a.id);
    expect([ra.labelStatus, ra.labelAttempts]).toEqual(['failed', 1]);
    expect(report.items[0]).toMatchObject({ outcome: 'failed', error: 'boom' });
    expect((await getRow(b.id)).labelStatus).toBe('labeled');
  });

  it('stops the run on a rate limit', async () => {
    const day = (d: number) => new Date(`2026-01-0${d}T00:00:00Z`);
    const a = await insertArticle('A', { publishedAt: day(1) });
    const b = await insertArticle('B', { publishedAt: day(2) });
    const c = await insertArticle('C', { publishedAt: day(3) });
    const labeler = createFakeLabeler((_, i) => {
      if (i === 1) throw new RateLimitError('429');
      return { primary_skill: 'cc-hooks', secondary_skills: [], difficulty: 1, type: 'news', quality: 1 };
    });
    const report = await run(labeler, { config: { ...config, label_batch: 3 } });
    expect((await getRow(a.id)).labelStatus).toBe('labeled');
    const rb = await getRow(b.id);
    expect([rb.labelStatus, rb.labelAttempts]).toEqual(['pending', 0]);
    const rc = await getRow(c.id);
    expect([rc.labelStatus, rc.labelAttempts]).toEqual(['pending', 0]);
    expect(server.hits('/pC')).toBe(0);
    expect(report.rateLimited).toBe(true);
    expect(report.items.find((i) => i.id === b.id)!.outcome).toBe('rate_limited');
  });

  it('retries a provider overload with the configured backoff, then labels', async () => {
    const a = await insertArticle('A');
    const labeler = createFakeLabeler((_, i) => {
      if (i < 2) throw new OverloadedError('provider overloaded (503)');
      return { primary_skill: 'cc-hooks', secondary_skills: [], difficulty: 1, type: 'news', quality: 1 };
    });
    const report = await run(labeler);
    expect(labeler.calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 5000]);
    const ra = await getRow(a.id);
    expect([ra.labelStatus, ra.labelAttempts]).toEqual(['labeled', 0]);
    expect([report.labeled, report.failed, report.rateLimited]).toEqual([1, 0, false]);
  });

  it('gives up on an article after the overload retries and continues with the next', async () => {
    const a = await insertArticle('A', { publishedAt: new Date('2026-01-01T00:00:00Z') });
    const b = await insertArticle('B', { publishedAt: new Date('2026-01-02T00:00:00Z') });
    const labeler = createFakeLabeler((_, i) => {
      if (i < 4) throw new OverloadedError('provider overloaded (503)');
      return { primary_skill: 'cc-hooks', secondary_skills: [], difficulty: 1, type: 'news', quality: 1 };
    });
    const report = await run(labeler);
    expect(labeler.calls.map((c) => c.title)).toEqual(['Title A', 'Title A', 'Title A', 'Title A', 'Title B']);
    expect(sleeps).toEqual([2000, 5000, 10000, 25]);
    const ra = await getRow(a.id);
    expect([ra.labelStatus, ra.labelAttempts]).toEqual(['failed', 1]);
    expect(report.items[0]).toMatchObject({ id: a.id, outcome: 'failed' });
    expect(report.items[0]!.error).toMatch(/overloaded.*3 retries/);
    expect((await getRow(b.id)).labelStatus).toBe('labeled');
    expect(report.rateLimited).toBe(false);
  });

  it('a 429 during overload retries still stops the run', async () => {
    const a = await insertArticle('A');
    const labeler = createFakeLabeler((_, i) => {
      if (i === 0) throw new OverloadedError('provider overloaded (503)');
      throw new RateLimitError('429');
    });
    const report = await run(labeler);
    expect(report.rateLimited).toBe(true);
    expect(sleeps).toEqual([2000]);
    const ra = await getRow(a.id);
    expect([ra.labelStatus, ra.labelAttempts]).toEqual(['pending', 0]);
  });

  it('stops the run on a fatal provider error without touching the article', async () => {
    const day = (d: number) => new Date(`2026-01-0${d}T00:00:00Z`);
    const a = await insertArticle('A', { publishedAt: day(1) });
    const b = await insertArticle('B', { publishedAt: day(2) });
    const c = await insertArticle('C', { publishedAt: day(3) });
    const labeler = createFakeLabeler((_, i) => {
      if (i === 1) throw new FatalLabelerError('provider rejected the request (401)');
      return { primary_skill: 'cc-hooks', secondary_skills: [], difficulty: 1, type: 'news', quality: 1 };
    });
    const report = await run(labeler, { config: { ...config, label_batch: 3 } });
    expect((await getRow(a.id)).labelStatus).toBe('labeled');
    for (const id of [b.id, c.id]) {
      const row = await getRow(id);
      expect([row.labelStatus, row.labelAttempts]).toEqual(['pending', 0]);
    }
    expect(server.hits('/pC')).toBe(0);
    expect(report.fatal).toBe('provider rejected the request (401)');
    expect(report.rateLimited).toBe(false);
    expect(report.failed).toBe(0);
    expect(report.items.map((i) => i.outcome)).toEqual(['labeled']);
  });

  it('turns a failing success transaction into a per-article failure and continues', async () => {
    const a = await insertArticle('A', { publishedAt: new Date('2026-01-01T00:00:00Z') });
    const b = await insertArticle('B', { publishedAt: new Date('2026-01-02T00:00:00Z') });
    let txCalls = 0;
    const flaky = Object.create(db) as Db;
    flaky.transaction = ((...args: Parameters<Db['transaction']>) => {
      if (txCalls++ === 0) return Promise.reject(new Error('tx boom'));
      return db.transaction(...args);
    }) as Db['transaction'];
    const report = await run(createFakeLabeler(), { db: flaky });
    const ra = await getRow(a.id);
    expect([ra.labelStatus, ra.labelAttempts]).toEqual(['failed', 1]);
    expect(report.items[0]).toMatchObject({ outcome: 'failed', error: 'tx boom' });
    expect((await getRow(b.id)).labelStatus).toBe('labeled');
    expect([report.labeled, report.failed]).toEqual([1, 1]);
  });

  it('propagates an error from fail() itself', async () => {
    await insertArticle('A');
    let updates = 0;
    const broken = Object.create(db) as Db;
    broken.update = ((...args: Parameters<Db['update']>) => {
      if (updates++ === 0) return db.update(...args);
      throw new Error('db down');
    }) as Db['update'];
    broken.transaction = (() => Promise.reject(new Error('tx boom'))) as Db['transaction'];
    await expect(run(createFakeLabeler(), { db: broken })).rejects.toThrow('db down');
  });

  it('sleeps only between labeler calls', async () => {
    const three = { config: { ...config, label_batch: 3 } };
    for (const n of [1, 2, 3]) await insertArticle(n, { publishedAt: new Date(`2026-01-0${n}T00:00:00Z`) });
    await run(createFakeLabeler(), three);
    expect(sleeps).toEqual([25, 25]);

    await resetDb(db);
    sleeps.length = 0;
    await insertArticle(4);
    await run(createFakeLabeler(), three);
    expect(sleeps).toHaveLength(0);

    await resetDb(db);
    sleeps.length = 0;
    await insertArticle(5, { publishedAt: new Date('2026-01-01T00:00:00Z') }, false);
    await insertArticle(6, { publishedAt: new Date('2026-01-02T00:00:00Z') });
    await insertArticle(7, { publishedAt: new Date('2026-01-03T00:00:00Z') });
    await run(createFakeLabeler(), three);
    expect(sleeps).toEqual([25]);
  });

  it('is idempotent on labeled rows', async () => {
    await insertArticle(1);
    await run(createFakeLabeler());
    const before = await db.select().from(articles);
    const labeler = createFakeLabeler();
    const report = await run(labeler);
    expect(report.selected).toBe(0);
    expect(labeler.calls).toHaveLength(0);
    expect(await db.select().from(articles)).toEqual(before);
  });

  it('honours the limit option', async () => {
    await insertArticle(1);
    await insertArticle(2);
    const report = await run(createFakeLabeler(), { limit: 1 });
    expect(report.labeled).toBe(1);
    expect(report.selected).toBe(1);
  });

  it('replaces stale skills on retry-success', async () => {
    const a = await insertArticle(1, { labelStatus: 'failed', labelAttempts: 1 });
    await db.insert(articleSkills).values([
      { articleId: a.id, skillId: 'stale-1', isPrimary: true },
      { articleId: a.id, skillId: 'stale-2', isPrimary: false },
    ]);
    await run(
      createFakeLabeler(() => ({
        primary_skill: 'cc-hooks',
        secondary_skills: ['cc-plugins'],
        difficulty: 1,
        type: 'news',
        quality: 1,
      })),
    );
    const skills = await db.select().from(articleSkills).where(eq(articleSkills.articleId, a.id));
    expect(skills.map((s) => [s.skillId, s.isPrimary]).sort()).toEqual([
      ['cc-hooks', true],
      ['cc-plugins', false],
    ]);
  });
});
