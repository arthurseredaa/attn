import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { articleCardSchema, type ArticleType, type EventKind } from '@attn/shared';
import { loadConfig, loadTaxonomy } from '../data';
import { articles, type Db } from '../db';
import { resetDb, testDb } from '../test/db';
import { addEvent, giveSkill, makeArticle, makeUser, RANK_NOW, rankConfig, rankSources } from './fixtures';
import { createSqlRanker } from './sql';

const taxonomy = loadTaxonomy();
const [S1, S2, S3] = taxonomy.domains.flatMap((d) => d.skills.map((s) => s.id)) as [string, string, string];
const DAY = 86_400_000;
const ago = (days: number) => new Date(RANK_NOW.getTime() - days * DAY);
const byNum = (x: number, y: number) => x - y;

let db: Db;
let u: string;
let ranker: ReturnType<typeof createSqlRanker>;

beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
  u = await makeUser(db);
  ranker = createSqlRanker(db, { config: rankConfig, sources: rankSources, taxonomy, now: () => RANK_NOW });
});

const ids = async (user = u) => (await ranker.rank(user, { limit: 100, offset: 0 })).map((c) => c.id);
const focus = (over = {}) => giveSkill(db, u, S1, { focusRank: 1, ...over });

/** Insert one article per difficulty 0..4 for S1 and return the set of difficulties that the feed returns. */
async function shown(): Promise<number[]> {
  const byDiff = new Map<number, number>();
  for (let d = 0; d <= 4; d++) byDiff.set(d, await makeArticle(db, { primary: S1, difficulty: d }));
  const got = new Set(await ids());
  return [...byDiff].filter(([, id]) => got.has(id)).map(([d]) => d);
}

describe('skill filter', () => {
  it('focus skill needs quality_min', async () => {
    await focus();
    const q2 = await makeArticle(db, { primary: S1, quality: 2 });
    await makeArticle(db, { primary: S1, quality: 1 });
    expect(await ids()).toEqual([q2]);
  });

  it('background skill needs background_quality_min', async () => {
    await giveSkill(db, u, S1);
    await makeArticle(db, { primary: S1, quality: 3 });
    const q4 = await makeArticle(db, { primary: S1, quality: 4 });
    expect(await ids()).toEqual([q4]);
  });

  it('only the primary skill qualifies', async () => {
    await focus();
    await makeArticle(db, { primary: S2, secondary: [S1] });
    const ok = await makeArticle(db, { primary: S1, secondary: [S2] });
    expect(await ids()).toEqual([ok]);
  });
});

describe('difficulty band', () => {
  it('level 2 certain: {2,3}', async () => {
    await focus();
    expect(await shown()).toEqual([2, 3]);
  });
  it('level 2 uncertain: 1..4', async () => {
    await focus({ uncertain: true });
    expect(await shown()).toEqual([1, 2, 3, 4]);
  });
  it('null level is level 1 and uncertain', async () => {
    await focus({ level: null, uncertain: true });
    expect(await shown()).toEqual([0, 1, 2, 3]);
  });
  it('null level with uncertain false is still uncertain', async () => {
    await focus({ level: null, uncertain: false });
    expect(await shown()).toEqual([0, 1, 2, 3]);
  });
  it('offset +1 shifts up', async () => {
    await focus({ difficultyOffset: 1 });
    expect(await shown()).toEqual([3, 4]);
  });
  it('offset -1 shifts down', async () => {
    await focus({ difficultyOffset: -1 });
    expect(await shown()).toEqual([1, 2]);
  });
  it('top clamp: level 4 offset +1 certain', async () => {
    await focus({ level: 4, difficultyOffset: 1 });
    expect(await shown()).toEqual([4]);
  });
  it('top clamp: level 3 offset +1 certain', async () => {
    await focus({ level: 3, difficultyOffset: 1 });
    expect(await shown()).toEqual([4]);
  });
  it('top clamp: level 4 offset +1 uncertain', async () => {
    await focus({ level: 4, difficultyOffset: 1, uncertain: true });
    expect(await shown()).toEqual([3, 4]);
  });
  it('level 4 offset -1 certain', async () => {
    await focus({ level: 4, difficultyOffset: -1 });
    expect(await shown()).toEqual([3, 4]);
  });
  it('no lower clamp: level 0 offset -1 certain', async () => {
    await focus({ level: 0, difficultyOffset: -1 });
    expect(await shown()).toEqual([0]);
  });
  it('rankConfig matches data/config.yml', () => {
    const c = loadConfig();
    expect(rankConfig).toEqual({
      quality_min: c.quality_min,
      background_quality_min: c.background_quality_min,
      fresh_days: c.fresh_days,
      background_priority: c.background_priority,
      fit_next: c.fit_next,
      fit_same: c.fit_same,
      fit_stretch: c.fit_stretch,
    });
  });
});

describe('freshness', () => {
  it.each(['release', 'news'] as ArticleType[])('%s: 13 days in, 15 out, 14 inclusive', async (type) => {
    await focus();
    const d13 = await makeArticle(db, { primary: S1, type, publishedAt: ago(13) });
    await makeArticle(db, { primary: S1, type, publishedAt: ago(15) });
    const d14 = await makeArticle(db, { primary: S1, type, publishedAt: ago(14) });
    expect((await ids()).sort(byNum)).toEqual([d13, d14].sort(byNum));
  });
  it('other types have no age limit; future release is fine', async () => {
    await focus();
    const want: number[] = [];
    for (const type of ['tutorial', 'deep_dive', 'research'] as ArticleType[]) {
      want.push(await makeArticle(db, { primary: S1, type, publishedAt: ago(400) }));
    }
    want.push(await makeArticle(db, { primary: S1, type: 'release', publishedAt: ago(-2) }));
    expect((await ids()).sort(byNum)).toEqual(want.sort(byNum));
  });
});

describe('events', () => {
  it('read and not_interested exclude; like, too_easy, too_hard do not', async () => {
    await focus();
    const kept: number[] = [];
    for (const kind of ['read', 'not_interested', 'like', 'too_easy', 'too_hard'] as EventKind[]) {
      const id = await makeArticle(db, { primary: S1 });
      await addEvent(db, u, id, kind);
      if (!['read', 'not_interested'].includes(kind)) kept.push(id);
    }
    expect((await ids()).sort(byNum)).toEqual(kept.sort(byNum));
  });
  it('other users events do not matter', async () => {
    const v = await makeUser(db);
    await focus();
    await giveSkill(db, v, S1, { focusRank: 1 });
    const id = await makeArticle(db, { primary: S1 });
    await addEvent(db, v, id, 'read');
    expect(await ids()).toEqual([id]);
    expect(await ids(v)).toEqual([]);
  });
});

describe('labeling and urls', () => {
  it('excluded rows are never ranked, even with a label, skills and high quality', async () => {
    await focus();
    const ok = await makeArticle(db, { primary: S1 });
    const gone = await makeArticle(db, { primary: S1, quality: 4 });
    await db.update(articles).set({ labelStatus: 'excluded', excludedReason: 'r' }).where(eq(articles.id, gone));
    expect(await ids()).toEqual([ok]);
  });

  it('pending and failed are excluded', async () => {
    await focus();
    await makeArticle(db, { primary: S1, status: 'pending' });
    await makeArticle(db, { primary: S1, status: 'failed' });
    expect(await ids()).toEqual([]);
  });
  it('label_status alone excludes: pending/failed rows that still carry difficulty, quality and type', async () => {
    await focus();
    const pending = await makeArticle(db, { primary: S1 });
    const failed = await makeArticle(db, { primary: S1 });
    const kept = await makeArticle(db, { primary: S1 });
    await db.update(articles).set({ labelStatus: 'pending' }).where(eq(articles.id, pending));
    await db.update(articles).set({ labelStatus: 'failed' }).where(eq(articles.id, failed));
    expect(await ids()).toEqual([kept]);
  });
  it('only http(s) urls', async () => {
    await focus();
    await makeArticle(db, { primary: S1, url: 'ftp://x.test/a' });
    await makeArticle(db, { primary: S1, url: 'javascript:alert(1)' });
    const a = await makeArticle(db, { primary: S1, url: 'http://x.test/a' });
    const b = await makeArticle(db, { primary: S1, url: 'https://x.test/b' });
    expect((await ids()).sort(byNum)).toEqual([a, b].sort(byNum));
  });
});

describe('card shape and one query', () => {
  it('maps the row to a valid card', async () => {
    await focus();
    const when = new Date('2026-10-13T08:30:15.123Z');
    const id = await makeArticle(db, { primary: S1, secondary: [S3, S2], publishedAt: when, difficulty: 3, quality: 4, type: 'deep_dive' });
    const unknown = await makeArticle(db, { primary: S1, sourceId: 'other' });
    const cards = await ranker.rank(u, { limit: 10, offset: 0 });
    for (const c of cards) expect(articleCardSchema.parse(c)).toEqual(c);
    const card = cards.find((c) => c.id === id)!;
    expect(card.publishedAt).toBe(when.toISOString());
    expect(card.skills.map((s) => [s.id, s.isPrimary])).toEqual([[S1, true], ...[S2, S3].sort().map((x) => [x, false])]);
    const name = (sid: string) => taxonomy.domains.flatMap((d) => d.skills).find((s) => s.id === sid)!.name;
    expect(card.skills.map((s) => s.name)).toEqual([S1, ...[S2, S3].sort()].map(name));
    expect(card).toMatchObject({ sourceId: 'src', sourceName: 'Source One', difficulty: 3, quality: 4, type: 'deep_dive', wordCount: 1000 });
    expect(cards.find((c) => c.id === unknown)).toMatchObject({ sourceId: 'other', sourceName: 'other' });
  });

  it('issues exactly one statement', async () => {
    await focus();
    await makeArticle(db, { primary: S1, secondary: [S2] });
    const spy = vi.spyOn(db, 'execute');
    await ranker.rank(u, { limit: 10, offset: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('rejects bad paging and non-uuid user ids', async () => {
    for (const p of [
      { limit: 0, offset: 0 },
      { limit: 1.5, offset: 0 },
      { limit: 1001, offset: 0 },
      { limit: 1, offset: -1 },
      { limit: 1, offset: 0.5 },
    ]) {
      await expect(ranker.rank(u, p)).rejects.toBeInstanceOf(RangeError);
      await expect(ranker.rankScored(u, p)).rejects.toBeInstanceOf(RangeError);
    }
    await expect(ranker.rank("x'; drop table users; --", { limit: 1, offset: 0 })).rejects.toThrow();
    expect((await db.execute(sql`select count(*)::int as n from users`))[0]!.n).toBe(1);
  });

  it('user without skills gets nothing', async () => {
    await makeArticle(db, { primary: S1 });
    expect(await ids()).toEqual([]);
  });
});
