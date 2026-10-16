import { beforeEach, describe, expect, it } from 'vitest';
import { loadTaxonomy } from '../data';
import type { Db } from '../db';
import { resetDb, testDb } from '../test/db';
import { addEvent, giveSkill, makeArticle, makeUser, RANK_NOW, rankConfig, rankSources } from './fixtures';
import { createSqlRanker } from './sql';

const taxonomy = loadTaxonomy();
const S1 = taxonomy.domains[0]!.skills[0]!.id;

let db: Db;
let u: string;
let ranker: ReturnType<typeof createSqlRanker>;

beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
  u = await makeUser(db);
  await giveSkill(db, u, S1, { focusRank: 1 });
  ranker = createSqlRanker(db, { config: rankConfig, sources: rankSources, taxonomy, now: () => RANK_NOW });
});

const page = async (limit: number, offset: number) => (await ranker.rank(u, { limit, offset })).map((c) => c.id);
const SAME = new Date(RANK_NOW.getTime() - 86_400_000);

async function pagesEqualFull(): Promise<number[]> {
  const full = await page(100, 0);
  const got = [...(await page(10, 0)), ...(await page(10, 10)), ...(await page(10, 20))];
  expect(got).toEqual(full);
  expect(new Set(got).size).toBe(got.length);
  return full;
}

describe('paging', () => {
  it('six score groups with distinct dates (ties broken by date): pages concatenate to the full order', async () => {
    for (let i = 0; i < 25; i++) {
      await makeArticle(db, {
        primary: S1,
        difficulty: 2 + (i % 2),
        quality: 2 + (i % 3),
        publishedAt: new Date(SAME.getTime() - i * 3_600_000),
      });
    }
    expect(await page(10, 0)).toHaveLength(10);
    expect(await page(10, 10)).toHaveLength(10);
    expect(await page(10, 20)).toHaveLength(5);
    expect(await pagesEqualFull()).toHaveLength(25);
  });

  it('identical scores and dates: id tie-break keeps pages stable', async () => {
    for (let i = 0; i < 25; i++) await makeArticle(db, { primary: S1, difficulty: 3, quality: 4, publishedAt: SAME });
    expect(await pagesEqualFull()).toHaveLength(25);
  });

  it('offset past the end is empty; limit beyond remainder returns the remainder', async () => {
    for (let i = 0; i < 7; i++) await makeArticle(db, { primary: S1, difficulty: 3 });
    expect(await page(10, 7)).toEqual([]);
    expect(await page(10, 500)).toEqual([]);
    expect(await page(10, 5)).toHaveLength(2);
  });

  it('a read between pages: offset = visible count neither repeats nor skips', async () => {
    const all: number[] = [];
    for (let i = 0; i < 25; i++)
      all.push(
        await makeArticle(db, {
          primary: S1,
          difficulty: 3,
          quality: 4,
          publishedAt: new Date(SAME.getTime() - i * 3_600_000),
        }),
      );
    const p1 = await page(10, 0);
    expect(p1).toEqual(all.slice(0, 10));
    await addEvent(db, u, p1[2]!, 'read');
    const visible = p1.length - 1;
    const p2 = await page(10, visible);
    expect(p2).toEqual(all.slice(10, 20));
    expect(p2.some((id) => p1.includes(id))).toBe(false);
  });

  it('large offsets work', async () => {
    for (let i = 0; i < 300; i++)
      await makeArticle(db, {
        primary: S1,
        difficulty: 3,
        quality: 4,
        publishedAt: new Date(SAME.getTime() - i * 1000),
      });
    expect(await page(20, 280)).toHaveLength(20);
  });
});
