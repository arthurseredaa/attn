import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSources, loadTaxonomy } from '@attn/core';
import { resetDb } from '@attn/core/testing';
import { articleCardSchema, articlesPageSchema, type ArticlesPage, type Config, type Source } from '@attn/shared';
import { startTestApp, type TestApp } from '../test/app';
import { seedArticle, skillIds, type SeedArticle } from '../test/seed';
import { APP_CONFIG } from '../tokens';

let ctx: TestApp;
const [S1, S2, S3] = skillIds(3) as [string, string, string];
const [realSource, otherSource] = loadSources() as [Source, Source];

beforeEach(async () => {
  ctx = await startTestApp();
  await resetDb(ctx.db);
});

afterEach(async () => {
  await ctx.close();
});

async function get(qs = ''): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${ctx.base}/api/articles${qs}`);
  return { status: res.status, body: await res.json() };
}

const page = async (qs = ''): Promise<ArticlesPage> => {
  const r = await get(qs);
  expect(r.status).toBe(200);
  return articlesPageSchema.parse(r.body);
};

const at = (iso: string): Date => new Date(iso);
const seed = (o: SeedArticle = {}) => seedArticle(ctx.db, { primary: S1, ...o });
const ids = (p: ArticlesPage) => p.items.map((i) => i.id);

describe('GET /api/articles', () => {
  it('is public and returns labeled articles only', async () => {
    const ok = await seed();
    await seed({ status: 'pending' });
    await seed({ status: 'failed' });
    await seed({ status: 'excluded' });
    const r = await get();
    expect(r.status).toBe(200);
    expect(ids(articlesPageSchema.parse(r.body))).toEqual([ok]);
  });

  it('never serves non-http(s) urls and keeps pagination exact', async () => {
    const t = (n: number) => at(`2026-02-0${n}T00:00:00.000Z`);
    const a = await seed({ publishedAt: t(1) });
    await seed({ publishedAt: t(2), url: 'javascript:alert(1)' });
    const b = await seed({ publishedAt: t(3) });
    await seed({ publishedAt: t(4), url: 'ftp://example.com/x' });
    const c = await seed({ publishedAt: t(5) });
    const full = await page();
    expect(ids(full)).toEqual([c, b, a]);
    const p1 = await page('?limit=3');
    expect(p1.nextCursor).toBeNull();
    const p2 = await page('?limit=2');
    expect(ids(p2)).toEqual([c, b]);
    expect(ids(await page(`?limit=2&cursor=${p2.nextCursor}`))).toEqual([a]);
  });

  it('400 for a cursor id above int4', async () => {
    const cursor = Buffer.from('{"t":"2026-03-02T00:00:00.000Z","id":2147483648}').toString('base64url');
    const r = await get(`?cursor=${cursor}`);
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe('bad_request');
  });

  it('orders newest first, ties by id descending', async () => {
    const old = await seed({ publishedAt: at('2026-01-01T00:00:00.000Z') });
    const t = at('2026-02-01T00:00:00.000Z');
    const a = await seed({ publishedAt: t });
    const b = await seed({ publishedAt: t });
    const c = await seed({ publishedAt: t });
    const newest = await seed({ publishedAt: at('2026-03-01T00:00:00.000Z') });
    expect(ids(await page())).toEqual([newest, c, b, a, old]);
  });

  it('builds the card from the row, taxonomy and sources', async () => {
    const taxonomy = loadTaxonomy();
    const nameOf = (id: string) => taxonomy.domains.flatMap((d) => d.skills).find((s) => s.id === id)!.name;
    await seed({
      primary: S1,
      secondary: [S2],
      sourceId: realSource.id,
      wordCount: 1500,
      publishedAt: at('2026-03-05T10:20:30.456Z'),
    });
    const [item] = (await page()).items;
    expect(item!.skills).toEqual([
      { id: S1, name: nameOf(S1), isPrimary: true },
      { id: S2, name: nameOf(S2), isPrimary: false },
    ]);
    expect(item!.sourceName).toBe(realSource.name);
    expect(item!.publishedAt).toBe('2026-03-05T10:20:30.456Z');
    expect(Object.keys(item!).sort()).toEqual(Object.keys(articleCardSchema.shape).sort());
  });

  it('falls back for an orphan skill and a null word count', async () => {
    await seed({ primary: 'orphan-skill', wordCount: null });
    const [item] = (await page()).items;
    expect(item!.skills).toEqual([{ id: 'orphan-skill', name: 'orphan-skill', isPrimary: true }]);
    expect(item!.wordCount).toBeNull();
  });

  it('skips articles of a source dropped from the config, also when asked for it', async () => {
    const kept = await seed();
    await seed({ sourceId: 'gone-source' });
    expect(ids(await page())).toEqual([kept]);
    expect(ids(await page('?source=gone-source'))).toEqual([]);
  });

  it('filters by source; unknown source gives an empty page', async () => {
    const a = await seed({ sourceId: realSource.id });
    await seed({ sourceId: otherSource.id });
    expect(ids(await page(`?source=${realSource.id}`))).toEqual([a]);
    expect(await get('?source=nope')).toEqual({ status: 200, body: { items: [], nextCursor: null } });
  });

  it('filters by skill on primary or secondary, without duplicates', async () => {
    const both = await seed({ primary: S1, secondary: [S2] });
    const only3 = await seed({ primary: S3 });
    expect(ids(await page(`?skill=${S2}`))).toEqual([both]);
    expect(ids(await page(`?skill=${S1}`))).toEqual([both]);
    expect(ids(await page(`?skill=${S3}`))).toEqual([only3]);
  });

  it('filters by several skills (any-match, repeatable param), no duplicates', async () => {
    const a = await seed({ primary: S1, secondary: [S2] });
    const b = await seed({ primary: S3 });
    await seed({ primary: 'orphan-skill' });
    expect(ids(await page(`?skill=${S1}&skill=${S2}`))).toEqual([a]);
    expect(ids(await page(`?skill=${S2}&skill=${S3}`)).sort()).toEqual([a, b].sort());
  });

  it('searches titles case-insensitively and treats % _ and backslash literally', async () => {
    const rag = await seed({ title: 'Building RAG Pipelines' });
    const pct = await seed({ title: '100% accuracy' });
    const us = await seed({ title: 'snake_case naming' });
    const bs = await seed({ title: 'path C:\\temp' });
    await seed({ title: 'plain' });
    expect(ids(await page('?q=rag%20pipe'))).toEqual([rag]);
    expect(ids(await page('?q=%25'))).toEqual([pct]);
    expect(ids(await page('?q=_'))).toEqual([us]);
    expect(ids(await page('?q=%5C'))).toEqual([bs]);
    expect(ids(await page('?q=%20%20'))).toHaveLength(5); // blank = no filter
    expect((await page('?q=zzz')).items).toEqual([]);
  });

  it('combines q, skill, source and dates, and paging carries the filters', async () => {
    const t = (n: number) => at(`2026-02-0${n}T00:00:00.000Z`);
    const a = await seed({ title: 'Agents 1', primary: S1, publishedAt: t(1) });
    await seed({ title: 'Agents 2', primary: S2, publishedAt: t(2) });
    const c = await seed({ title: 'Agents 3', primary: S1, secondary: [S3], publishedAt: t(3) });
    await seed({ title: 'Other', primary: S1, publishedAt: t(4) });
    const d = await seed({ title: 'Agents 5', primary: S3, publishedAt: t(5) });
    const qs = `skill=${S1}&skill=${S3}&q=agents`;
    expect(ids(await page(`?${qs}`))).toEqual([d, c, a]);
    const p1 = await page(`?${qs}&limit=2`);
    expect(ids(p1)).toEqual([d, c]);
    expect(ids(await page(`?${qs}&limit=2&cursor=${p1.nextCursor}`))).toEqual([a]);
    expect(ids(await page(`?${qs}&from=2026-02-02&to=2026-02-04`))).toEqual([c]);
  });

  it('applies date ranges with the documented bounds', async () => {
    const a = await seed({ publishedAt: at('2026-03-01T23:59:59.999Z') });
    const b = await seed({ publishedAt: at('2026-03-02T00:00:00.000Z') });
    const c = await seed({ publishedAt: at('2026-03-02T12:00:00.000Z') });
    const d = await seed({ publishedAt: at('2026-03-03T00:00:00.000Z') });
    expect(ids(await page('?from=2026-03-02&to=2026-03-02')).sort()).toEqual([b, c].sort());
    expect(ids(await page('?from=2026-03-02T12:00:00Z')).sort()).toEqual([c, d].sort());
    expect(ids(await page('?to=2026-03-02T00:00:00Z')).sort()).toEqual([a, b].sort());
  });

  it('paginates across equal timestamps with no gaps or duplicates', async () => {
    const t = at('2026-02-01T00:00:00.000Z');
    for (let i = 0; i < 4; i++) await seed({ publishedAt: t });
    for (let i = 0; i < 3; i++) await seed({ publishedAt: at(`2026-02-0${2 + i}T00:00:00.000Z`) });
    const full = ids(await page('?limit=50'));
    expect(full).toHaveLength(7);
    const walked: number[] = [];
    let cursor: string | null = null;
    let last: ArticlesPage | undefined;
    do {
      last = await page(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      walked.push(...ids(last));
      cursor = last.nextCursor;
    } while (cursor);
    expect(walked).toEqual(full);
    expect(last.nextCursor).toBeNull();
  });

  it('returns a null cursor exactly at the boundary', async () => {
    for (let i = 0; i < 4; i++) await seed({ publishedAt: at(`2026-02-0${1 + i}T00:00:00.000Z`) });
    expect((await page('?limit=4')).nextCursor).toBeNull();
    const p1 = await page('?limit=3');
    expect(p1.items).toHaveLength(3);
    expect(typeof p1.nextCursor).toBe('string');
    const p2 = await page(`?limit=3&cursor=${p1.nextCursor}`);
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
  });

  it('combines a filter with a cursor', async () => {
    const a: number[] = [];
    for (let i = 0; i < 5; i++) {
      a.push(await seed({ sourceId: realSource.id, publishedAt: at(`2026-02-0${1 + i}T00:00:00.000Z`) }));
      await seed({ sourceId: otherSource.id, publishedAt: at(`2026-02-0${1 + i}T06:00:00.000Z`) });
    }
    const walked: number[] = [];
    let cursor: string | null = null;
    do {
      const p: ArticlesPage = await page(`?source=${realSource.id}&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(p.items.every((i) => i.sourceId === realSource.id)).toBe(true);
      walked.push(...ids(p));
      cursor = p.nextCursor;
    } while (cursor);
    expect(walked).toEqual([...a].reverse());
  });

  it('defaults to page_size and accepts limit 1 and 50', async () => {
    const pageSize = ctx.moduleRef.get<Config>(APP_CONFIG, { strict: false }).page_size;
    for (let i = 0; i < pageSize + 1; i++) await seed({ publishedAt: new Date(Date.UTC(2026, 0, 1, 0, i)) });
    const p = await page();
    expect(p.items).toHaveLength(pageSize);
    expect(p.nextCursor).not.toBeNull();
    expect((await page('?limit=1')).items).toHaveLength(1);
    expect((await page('?limit=50')).items).toHaveLength(pageSize + 1);
  });

  it.each([
    ['limit=0', 'limit'],
    ['limit=51', 'limit'],
    ['limit=abc', 'limit'],
    ['from=nope', 'from'],
    ['to=2026-02-31', 'to'],
    ['from=2026-03-02&to=2026-03-01', 'to'],
    ['cursor=garbage', 'cursor'],
    ['cursor=', 'cursor'],
    ['skill=nope', 'skill'],
    [`skill=${S1}&skill=nope`, 'skill'],
    [`q=${'x'.repeat(101)}`, 'q'],
    ['skill=a&skill=b&skill=c&skill=d&skill=e&skill=f&skill=g&skill=h&skill=i&skill=j&skill=k', 'skill'],
  ])('400 with the error shape for %s', async (qs, field) => {
    const r = await get(`?${qs}`);
    expect(r.status).toBe(400);
    const body = r.body as { error: string; message: string };
    expect(Object.keys(body).sort()).toEqual(['error', 'message']);
    expect(body.error).toBe('bad_request');
    expect(body.message).toContain(field);
    expect(JSON.stringify(body)).not.toMatch(/\bat\s.+:\d+|node_modules|stack/i);
  });

  it('returns an empty page for an empty database', async () => {
    expect(await get()).toEqual({ status: 200, body: { items: [], nextCursor: null } });
  });
});
