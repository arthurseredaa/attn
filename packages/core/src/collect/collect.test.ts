import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Source } from '@attn/shared';
import type { Db } from '../db/client';
import { articles, sourceState } from '../db/schema';
import { startServer, type TestServer } from '../test/server';
import { resetDb, testDb } from '../test/db';
import { collectAll, collectSource } from './collect';
import { readFixture } from './fixtures/load';

const now = new Date('2026-10-14T12:00:00Z');
const config = { backfill_days: 180 };

let db: Db;
let server: TestServer;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
  server = await startServer();
});
afterEach(() => server.close());

const xml = { 'Content-Type': 'application/xml' };
const fixtureRoute = (name: string, headers: Record<string, string> = xml) => ({
  headers,
  body: readFixture(name, server.baseUrl),
});
const rss = (id: string, path: string, filter?: Source['filter']): Source => ({
  id,
  name: id,
  type: 'rss',
  url: `${server.baseUrl}${path}`,
  ...(filter ? { filter } : {}),
});
const sitemap = (id: string, path: string, filter?: Source['filter']): Source => ({
  id,
  name: id,
  type: 'sitemap',
  url: `${server.baseUrl}${path}`,
  path_prefix: '/news/',
  ...(filter ? { filter } : {}),
});
const run = (source: Source, extra: { backfillDays?: number; timeoutMs?: number } = {}) =>
  collectSource({ db, source, config, now, ...extra });
const rows = () => db.select().from(articles).orderBy(asc(articles.id));
const stateOf = async (id: string) =>
  (await db.select().from(sourceState).where(eq(sourceState.sourceId, id)))[0];
const counts = (r: Awaited<ReturnType<typeof run>>) => ({
  seen: r.seen,
  inserted: r.inserted,
  duplicates: r.duplicates,
  tooOld: r.tooOld,
  skipped: r.skipped,
});
const html = (title: string) => ({
  headers: { 'Content-Type': 'text/html' },
  body: `<html><head><meta property="og:title" content="${title}"></head></html>`,
});

describe('rss', () => {
  it('first run inserts, normalizes and saves the etag', async () => {
    server.setRoute('/rss.xml', fixtureRoute('rss.xml', { ...xml, ETag: '"v1"' }));
    const r = await run(rss('r', '/rss.xml'));
    expect(r.status).toBe('ok');
    expect(counts(r)).toEqual({ seen: 7, inserted: 4, duplicates: 0, tooOld: 1, skipped: 2 });
    const all = await rows();
    expect(all.map((a) => a.title)).toEqual(['First post', 'Tom & Jerry', 'Undated', 'Future']);
    const first = all[0]!;
    expect(first.url).toBe(`${server.baseUrl}/posts/one`);
    expect(first.titleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.labelStatus).toBe('pending');
    expect(all[2]!.publishedAt).toEqual(now);
    expect((await stateOf('r'))!.etag).toBe('"v1"');
  });

  it('second run is not_modified when the server answers 304', async () => {
    server.setRoute('/rss.xml', (req) =>
      req.headers['if-none-match'] === '"v1"'
        ? { status: 304 }
        : fixtureRoute('rss.xml', { ...xml, ETag: '"v1"' }),
    );
    await run(rss('r', '/rss.xml'));
    const r = await run(rss('r', '/rss.xml'));
    expect(r.status).toBe('not_modified');
    expect(counts(r)).toEqual({ seen: 0, inserted: 0, duplicates: 0, tooOld: 0, skipped: 0 });
    expect(await rows()).toHaveLength(4);
  });

  it('server ignoring conditional headers yields duplicates, not rows', async () => {
    server.setRoute('/rss.xml', fixtureRoute('rss.xml'));
    await run(rss('r', '/rss.xml'));
    const r = await run(rss('r', '/rss.xml'));
    expect(r.status).toBe('ok');
    expect(counts(r)).toEqual({ seen: 7, inserted: 0, duplicates: 4, tooOld: 1, skipped: 2 });
    expect(await rows()).toHaveLength(4);
  });

  it('collapses url variants into one row', async () => {
    server.setRoute('/v.xml', fixtureRoute('variants.xml'));
    const r = await run(rss('v', '/v.xml'));
    expect(counts(r)).toEqual({ seen: 4, inserted: 1, duplicates: 2, tooOld: 0, skipped: 1 });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.url).toBe(`${server.baseUrl}/Posts/Dup`);
  });

  it('reads atom end to end', async () => {
    server.setRoute('/atom.xml', fixtureRoute('atom.xml'));
    const r = await run(rss('a', '/atom.xml'));
    expect(r.inserted).toBe(3);
    expect((await rows()).map((a) => a.title).sort()).toEqual(['Atom one', 'Atom three', 'Atom two']);
  });

  it('backfillDays overrides config', async () => {
    server.setRoute('/rss.xml', fixtureRoute('rss.xml'));
    const r = await run(rss('r', '/rss.xml'), { backfillDays: 10 });
    expect(r.inserted).toBe(3);
    expect(r.tooOld).toBe(2);
  });

  it('applies the source filter', async () => {
    server.setRoute('/f.xml', fixtureRoute('filter.xml'));
    const r = await run(rss('f', '/f.xml', { path_prefix: ['/blog/'], keywords: ['ai'] }));
    expect(r.inserted).toBe(1);
    expect(r.skipped).toBe(2);
    expect((await rows())[0]!.title).toBe('AI Gateway GA');
  });

  it('broken xml is an error with no rows and no etag', async () => {
    server.setRoute('/b.xml', fixtureRoute('broken.xml', { ...xml, ETag: '"b"' }));
    const r = await run(rss('b', '/b.xml'));
    expect(r.status).toBe('error');
    expect(r.error).toBeTruthy();
    expect(await rows()).toHaveLength(0);
    const st = await stateOf('b');
    expect(st!.etag).toBeNull();
    expect(st!.lastError).toBeTruthy();
  });
});

describe('sitemap', () => {
  beforeEach(() => {
    server.setRoute('/sitemap.xml', fixtureRoute('sitemap.xml'));
    server.setRoute('/news/alpha', html('Alpha OG'));
    server.setRoute('/news/beta', html('Beta OG'));
    server.setRoute('/news/gamma', html('Gamma OG'));
  });

  it('first run skips undated urls, later runs insert them without refetching known ones', async () => {
    const src = sitemap('s', '/sitemap.xml');
    const r1 = await run(src);
    expect(counts(r1)).toEqual({ seen: 4, inserted: 2, duplicates: 0, tooOld: 1, skipped: 1 });
    const all = await rows();
    expect(all.map((a) => a.title)).toEqual(['Alpha OG', 'Beta OG']);
    expect(all[0]!.publishedAt).toEqual(new Date('2026-10-02T00:00:00Z'));
    expect(all[1]!.publishedAt).toEqual(new Date('2026-09-15T08:30:00Z'));

    const r2 = await run(src);
    expect(counts(r2)).toEqual({ seen: 4, inserted: 1, duplicates: 2, tooOld: 1, skipped: 0 });
    const gamma = (await rows()).find((a) => a.title === 'Gamma OG')!;
    expect(gamma.publishedAt).toEqual(now);
    expect(server.hits('/news/alpha')).toBe(1);
  });

  it('a failed first run does not make the next run page-fetch undated urls', async () => {
    const src = sitemap('s', '/sitemap.xml');
    server.setRoute('/sitemap.xml', { status: 500 });
    expect((await run(src)).status).toBe('error');
    server.setRoute('/sitemap.xml', fixtureRoute('sitemap.xml'));
    const r = await run(src);
    expect(counts(r)).toEqual({ seen: 4, inserted: 2, duplicates: 0, tooOld: 1, skipped: 1 });
    expect(server.hits('/news/gamma')).toBe(0);
  });

  it('skips, does not insert and keeps validators when a page fetch fails; a later run retries', async () => {
    const src = sitemap('s', '/sitemap.xml');
    server.setRoute('/sitemap.xml', fixtureRoute('sitemap.xml', { ...xml, ETag: '"v1"' }));
    server.setRoute('/news/beta', { status: 500 });
    const r1 = await run(src);
    expect(counts(r1)).toEqual({ seen: 4, inserted: 1, duplicates: 0, tooOld: 1, skipped: 2 });
    expect((await rows()).map((a) => a.title)).toEqual(['Alpha OG']);
    const st = await stateOf('s');
    expect(st?.etag).toBeNull();
    expect(st?.lastRunAt).toEqual(now);

    server.setRoute('/news/beta', html('Beta OG'));
    const r2 = await run(src);
    expect(r2.status).toBe('ok');
    expect((await rows()).map((a) => a.title)).toEqual(['Alpha OG', 'Beta OG', 'Gamma OG']);
    expect((await stateOf('s'))?.etag).toBe('"v1"');
  });

  it('follows a sitemap index one level deep', async () => {
    const urlset = (path: string) =>
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${server.baseUrl}${path}</loc><lastmod>2026-10-01</lastmod></url></urlset>`;
    server.setRoute('/idx.xml', {
      headers: xml,
      body: `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>${server.baseUrl}/sa.xml</loc></sitemap>
        <sitemap><loc>${server.baseUrl}/sb.xml</loc></sitemap>
        <sitemap><loc>${server.baseUrl}/sc.xml</loc></sitemap></sitemapindex>`,
    });
    server.setRoute('/sa.xml', { headers: xml, body: urlset('/news/alpha') });
    server.setRoute('/sb.xml', { headers: xml, body: urlset('/news/beta') });
    server.setRoute('/sc.xml', {
      headers: xml,
      body: `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${server.baseUrl}/sa.xml</loc></sitemap></sitemapindex>`,
    });
    const r = await run(sitemap('s', '/idx.xml'));
    expect(r.status).toBe('ok');
    expect(r.inserted).toBe(2);
    expect(await rows()).toHaveLength(2);
  });

  it('applies the source filter to sitemap sources', async () => {
    const r = await run(sitemap('s', '/sitemap.xml', { exclude_path_prefix: ['/news/beta'] }));
    expect(r.inserted).toBe(1);
    expect(r.skipped).toBe(2);
    expect((await rows()).map((a) => a.title)).toEqual(['Alpha OG']);
  });
});

describe('collectAll', () => {
  it('isolates a failing source', async () => {
    server.setRoute('/rss.xml', fixtureRoute('rss.xml'));
    server.setRoute('/bad.xml', { status: 500 });
    const reports = await collectAll({
      db,
      config,
      now,
      sources: [rss('bad', '/bad.xml'), rss('good', '/rss.xml')],
    });
    expect(reports.map((r) => r.status)).toEqual(['error', 'ok']);
    expect((await rows()).filter((a) => a.sourceId === 'good')).toHaveLength(4);
    expect((await stateOf('bad'))!.lastError).toContain('500');
    expect((await stateOf('good'))!.lastError).toBeNull();
  });

  it('a stalled source times out without affecting others', async () => {
    server.setRoute('/slow.xml', { ...fixtureRoute('rss.xml'), delayMs: 500 });
    server.setRoute('/atom.xml', fixtureRoute('atom.xml'));
    const reports = await collectAll({
      db,
      config,
      now,
      timeoutMs: 50,
      sources: [rss('slow', '/slow.xml'), rss('ok', '/atom.xml')],
    });
    expect(reports[0]!.status).toBe('error');
    expect(reports[1]!.inserted).toBe(3);
  });

  it('rejects unknown ids and honours onlySourceIds', async () => {
    server.setRoute('/rss.xml', fixtureRoute('rss.xml'));
    server.setRoute('/atom.xml', fixtureRoute('atom.xml'));
    const sources = [rss('a', '/rss.xml'), rss('b', '/atom.xml')];
    await expect(collectAll({ db, config, now, sources, onlySourceIds: ['nope'] })).rejects.toThrow(
      'unknown source id(s): nope',
    );
    expect(await rows()).toHaveLength(0);
    const reports = await collectAll({ db, config, now, sources, onlySourceIds: ['b'] });
    expect(reports.map((r) => r.sourceId)).toEqual(['b']);
    expect(server.hits('/rss.xml')).toBe(0);
  });
});

describe('failure isolation', () => {
  it('reports an error result when recording the failure also fails', async () => {
    const broken = new Proxy(db, {
      get(t, prop, recv) {
        if (prop === 'insert') throw new Error('db down');
        return Reflect.get(t, prop, recv);
      },
    }) as Db;
    server.setRoute('/feed.xml', { status: 500 });
    const reports = await collectAll({
      db: broken,
      sources: [rss('a', '/feed.xml'), rss('b', '/feed.xml')],
      config,
      now,
    });
    expect(reports.map((r) => r.status)).toEqual(['error', 'error']);
    expect(reports[0]!.error).toContain('failed to record failure');
  });
});
