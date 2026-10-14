import { beforeEach, describe, expect, it } from 'vitest';
import { loadTaxonomy } from '../data';
import type { Db } from '../db';
import { resetDb, testDb } from '../test/db';
import { giveSkill, makeArticle, makeUser, RANK_NOW, rankConfig, rankSources } from './fixtures';
import { createSqlRanker } from './sql';
import type { RankConfig } from './types';

const taxonomy = loadTaxonomy();
const [S1, S2, S3, S4, S5, S6] = taxonomy.domains.flatMap((d) => d.skills.map((s) => s.id)) as string[] as [
  string, string, string, string, string, string,
];
const DAY = 86_400_000;
const ago = (days: number) => new Date(RANK_NOW.getTime() - days * DAY);

let db: Db;
let u: string;

beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
  u = await makeUser(db);
});

const mk = (over: Partial<RankConfig> = {}) =>
  createSqlRanker(db, { config: { ...rankConfig, ...over }, sources: rankSources, taxonomy, now: () => RANK_NOW });
const scores = async (over: Partial<RankConfig> = {}) => (await mk(over).rankScored(u, { limit: 100, offset: 0 })).map((s) => s.score);
const scoredIds = async () => (await mk().rankScored(u, { limit: 100, offset: 0 })).map((s) => s.card.id);
const focus1 = (over = {}) => giveSkill(db, u, S1, { focusRank: 1, ...over });

describe('score factors', () => {
  it('priority by focus rank', async () => {
    for (const [i, s] of [S1, S2, S3, S4, S5].entries()) {
      await giveSkill(db, u, s, { focusRank: i + 1 });
      await makeArticle(db, { primary: s, difficulty: 3, quality: 4 });
    }
    const got = await scores();
    [1.0, 0.8, 0.6, 0.4, 0.2].forEach((x, i) => expect(got[i]).toBeCloseTo(x, 9));
    expect(got).toHaveLength(5);
  });

  it('background priority comes from config', async () => {
    await giveSkill(db, u, S1);
    await makeArticle(db, { primary: S1, difficulty: 3, quality: 4 });
    expect((await scores())[0]).toBeCloseTo(0.1, 9);
    expect((await scores({ background_priority: 0.5 }))[0]).toBeCloseTo(0.5, 9);
  });

  it('fit branches', async () => {
    await focus1({ uncertain: true });
    const byD = new Map<number, number>();
    for (const d of [3, 2, 1, 4]) byD.set(d, await makeArticle(db, { primary: S1, difficulty: d, quality: 4, publishedAt: ago(1 + d) }));
    const by = async (over: Partial<RankConfig> = {}) => {
      const r = await mk(over).rankScored(u, { limit: 100, offset: 0 });
      return (d: number) => r.find((x) => x.card.id === byD.get(d))!.score;
    };
    let f = await by();
    expect([f(3), f(2), f(1), f(4)]).toEqual([1.0, 0.8, 0.5, 0.5].map((x) => expect.closeTo(x, 9)));
    f = await by({ fit_stretch: 0.25 });
    expect(f(1)).toBeCloseTo(0.25, 9);
    expect(f(4)).toBeCloseTo(0.25, 9);
    f = await by({ fit_next: 0.9, fit_same: 0.7 });
    expect(f(3)).toBeCloseTo(0.9, 9);
    expect(f(2)).toBeCloseTo(0.7, 9);
  });

  it('quality factor', async () => {
    await focus1();
    for (const q of [4, 3, 2]) await makeArticle(db, { primary: S1, difficulty: 3, quality: q });
    const got = await scores();
    [1.0, 0.75, 0.5].forEach((x, i) => expect(got[i]).toBeCloseTo(x, 9));
  });

  it('interest factor, real cast to numeric', async () => {
    await focus1({ interest: 0.5 });
    await makeArticle(db, { primary: S1, difficulty: 3, quality: 4 });
    expect((await scores())[0]).toBeCloseTo(0.5, 9);
    await resetDb(db);
    u = await makeUser(db);
    await focus1({ interest: 0.8 });
    await makeArticle(db, { primary: S1, difficulty: 3, quality: 4 });
    expect((await scores())[0]).toBeCloseTo(0.8, 9);
  });

  it('hand-computed combos', async () => {
    await giveSkill(db, u, S1, { focusRank: 2, interest: 0.5 });
    await giveSkill(db, u, S2, { level: null, uncertain: true });
    await makeArticle(db, { primary: S1, difficulty: 3, quality: 3 });
    await makeArticle(db, { primary: S2, difficulty: 0, quality: 4 });
    const got = await scores();
    expect(got[0]).toBeCloseTo(0.3, 9);
    expect(got[1]).toBeCloseTo(0.05, 9);
  });

  it('offset changes fit', async () => {
    await focus1({ difficultyOffset: 1 });
    const a4 = await makeArticle(db, { primary: S1, difficulty: 4, quality: 4 });
    const a3 = await makeArticle(db, { primary: S1, difficulty: 3, quality: 4 });
    const r = await mk().rankScored(u, { limit: 10, offset: 0 });
    expect(r.find((x) => x.card.id === a4)!.score).toBeCloseTo(1.0, 9);
    expect(r.find((x) => x.card.id === a3)!.score).toBeCloseTo(0.8, 9);
  });

  it('top clamp: difficulty 4 at level 4 offset +1 is fit_same', async () => {
    for (const level of [4, 3]) {
      await resetDb(db);
      u = await makeUser(db);
      await focus1({ level, difficultyOffset: 1 });
      const a4 = await makeArticle(db, { primary: S1, difficulty: 4, quality: 4 });
      await makeArticle(db, { primary: S1, difficulty: 3, quality: 4 });
      const r = await mk().rankScored(u, { limit: 10, offset: 0 });
      expect(r.map((x) => x.card.id)).toEqual([a4]);
      expect(r[0]!.score).toBeCloseTo(0.8, 9);
    }
    await resetDb(db);
    u = await makeUser(db);
    await focus1({ level: 0, difficultyOffset: -1 });
    await makeArticle(db, { primary: S1, difficulty: 0, quality: 4 });
    expect((await scores())[0]).toBeCloseTo(1.0, 9);
  });
});

describe('ordering', () => {
  it('score beats recency', async () => {
    await focus1();
    const low = await makeArticle(db, { primary: S1, difficulty: 2, quality: 4, publishedAt: ago(1) });
    const high = await makeArticle(db, { primary: S1, difficulty: 3, quality: 4, publishedAt: ago(9) });
    expect(await scoredIds()).toEqual([high, low]);
  });

  it('ties break by recency then id desc, deterministically', async () => {
    await focus1();
    const old = await makeArticle(db, { primary: S1, difficulty: 3, publishedAt: ago(3) });
    const nw = await makeArticle(db, { primary: S1, difficulty: 3, publishedAt: ago(1) });
    expect(await scoredIds()).toEqual([nw, old]);
    await resetDb(db);
    u = await makeUser(db);
    await focus1();
    const t = [];
    for (let i = 0; i < 3; i++) t.push(await makeArticle(db, { primary: S1, difficulty: 3 }));
    const want = [...t].reverse();
    expect(await scoredIds()).toEqual(want);
    expect(await scoredIds()).toEqual(want);
  });

  it('equal-but-computed-differently scores tie exactly', async () => {
    await giveSkill(db, u, S1, { focusRank: 3 });
    await giveSkill(db, u, S2, { focusRank: 1, interest: 0.6 });
    const older = await makeArticle(db, { primary: S1, difficulty: 3, quality: 4, publishedAt: ago(3) });
    const newer = await makeArticle(db, { primary: S2, difficulty: 3, quality: 4, publishedAt: ago(1) });
    const r = await mk().rankScored(u, { limit: 10, offset: 0 });
    expect(r.map((x) => x.card.id)).toEqual([newer, older]);
    expect(r[0]!.score).toBeCloseTo(0.6, 9);
    expect(r[0]!.score).toBe(r[1]!.score);
  });

  it('cross-skill mix', async () => {
    await giveSkill(db, u, S1, { focusRank: 1 });
    await giveSkill(db, u, S2, { focusRank: 2, uncertain: true });
    await giveSkill(db, u, S3);
    await giveSkill(db, u, S4, { focusRank: 3, interest: 0.5 });
    const A = await makeArticle(db, { primary: S1, difficulty: 3, quality: 4 });
    const B = await makeArticle(db, { primary: S1, difficulty: 2, quality: 4 });
    const C = await makeArticle(db, { primary: S2, difficulty: 1, quality: 4 });
    const D = await makeArticle(db, { primary: S4, difficulty: 3, quality: 4 });
    const E = await makeArticle(db, { primary: S3, difficulty: 3, quality: 4 });
    const F = await makeArticle(db, { primary: S2, difficulty: 3, quality: 2, publishedAt: ago(6) });
    const r = await mk().rankScored(u, { limit: 10, offset: 0 });
    expect(r.map((x) => x.card.id)).toEqual([A, B, C, F, D, E]);
    [1.0, 0.8, 0.4, 0.4, 0.3, 0.1].forEach((x, i) => expect(r[i]!.score).toBeCloseTo(x, 9));
  });

  it('rank returns the same ids as rankScored', async () => {
    await focus1();
    for (let i = 0; i < 4; i++) await makeArticle(db, { primary: S1, difficulty: 2 + (i % 2), quality: 2 + i % 3 });
    const m = mk();
    const cards = (await m.rank(u, { limit: 10, offset: 0 })).map((c) => c.id);
    expect(cards).toEqual((await m.rankScored(u, { limit: 10, offset: 0 })).map((s) => s.card.id));
    expect(cards).toHaveLength(4);
  });
});
void S6;
