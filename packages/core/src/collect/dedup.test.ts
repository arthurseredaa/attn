import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client';
import { articles } from '../db/schema';
import { resetDb, testDb } from '../test/db';
import { isDuplicate, urlExists, type Candidate } from './dedup';
import { titleHash } from './normalize';

let db: Db;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
  await db.insert(articles).values({
    sourceId: 's1',
    url: 'https://a.test/one',
    guid: 'g1',
    title: 'Hello World',
    titleHash: titleHash('Hello World'),
    publishedAt: new Date('2026-10-10T23:30:00Z'),
  });
});

function cand(over: Partial<Candidate>): Candidate {
  return {
    sourceId: 's2',
    url: 'https://b.test/other',
    guid: 'other',
    title: 'Unrelated',
    titleHash: titleHash('Unrelated'),
    publishedAt: new Date('2026-10-10T12:00:00Z'),
    ...over,
  };
}

describe('urlExists', () => {
  it('true for a stored url, false otherwise', async () => {
    expect(await urlExists(db, 'https://a.test/one')).toBe(true);
    expect(await urlExists(db, 'https://a.test/two')).toBe(false);
  });
});

describe('isDuplicate', () => {
  it('same url', async () => {
    expect(await isDuplicate(db, cand({ url: 'https://a.test/one' }))).toBe(true);
  });
  it('same guid, different url and source (global)', async () => {
    expect(await isDuplicate(db, cand({ guid: 'g1' }))).toBe(true);
  });
  it('same title hash on the same UTC day', async () => {
    const c = cand({ titleHash: titleHash('hello, world!'), publishedAt: new Date('2026-10-10T00:00:00Z') });
    expect(await isDuplicate(db, c)).toBe(true);
  });
  it('same title hash on a different day', async () => {
    const c = cand({ titleHash: titleHash('Hello World'), publishedAt: new Date('2026-10-11T00:00:00Z') });
    expect(await isDuplicate(db, c)).toBe(false);
  });
  it('unrelated', async () => {
    expect(await isDuplicate(db, cand({}))).toBe(false);
  });
});
