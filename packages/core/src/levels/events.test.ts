import { and, asc, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EventKind } from '@attn/shared';
import { loadTaxonomy } from '../data';
import { articleEvents, articleSkills, quizAnswers, userSkills, type Db } from '../db';
import { addEvent, giveSkill, makeArticle, makeUser } from '../rank/fixtures';
import { resetDb, testDb } from '../test/db';
import { ArticleNotFoundError, recordEvent, type FeedbackConfig } from './events';
import { saveOnboarding } from './store';

const cfg: FeedbackConfig = { points_per_level: 5, offset_k: 3, interest_decay: 0.8, interest_min: 0.2 };
const taxonomy = loadTaxonomy();
const [S1, S2] = taxonomy.domains.flatMap((d) => d.skills.map((s) => s.id)) as [string, string];
const KINDS: EventKind[] = ['read', 'like', 'too_easy', 'too_hard', 'not_interested'];

let db: Db;
let u: string;

beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
  u = await makeUser(db);
});

const rec = (articleId: number, kind: EventKind, userId = u, c: FeedbackConfig = cfg) =>
  recordEvent(db, { userId, articleId, kind }, c);

async function row(userId: string, skillId: string) {
  const [r] = await db
    .select()
    .from(userSkills)
    .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)));
  if (!r) throw new Error(`no user_skills row ${skillId}`);
  return r;
}

async function eventCount(userId?: string, articleId?: number, kind?: EventKind): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(articleEvents)
    .where(
      and(
        userId ? eq(articleEvents.userId, userId) : undefined,
        articleId !== undefined ? eq(articleEvents.articleId, articleId) : undefined,
        kind ? eq(articleEvents.kind, kind) : undefined,
      ),
    );
  return r!.n;
}

const articlesOf = (n: number, primary = S1, difficulty = 2) =>
  Promise.all(Array.from({ length: n }, () => makeArticle(db, { primary, difficulty })));

const offset = async (userId = u, skillId = S1) => (await row(userId, skillId)).difficultyOffset;

describe('read', () => {
  it('awards one point when difficulty >= level; a repeat is a no-op', async () => {
    await giveSkill(db, u, S1, { level: 2, points: 0 });
    const a = await makeArticle(db, { primary: S1, difficulty: 2 });
    expect(await rec(a, 'read')).toEqual({ recorded: true, skillUpdated: true });
    expect(await row(u, S1)).toMatchObject({ level: 2, points: 1 });
    expect(await eventCount(u, a, 'read')).toBe(1);
    expect(await rec(a, 'read')).toEqual({ recorded: false, skillUpdated: false });
    expect(await row(u, S1)).toMatchObject({ level: 2, points: 1 });
    expect(await eventCount(u, a, 'read')).toBe(1);
  });

  it('records but awards nothing below the level; above the level awards', async () => {
    await giveSkill(db, u, S1, { level: 2, points: 0 });
    const easy = await makeArticle(db, { primary: S1, difficulty: 1 });
    expect(await rec(easy, 'read')).toEqual({ recorded: true, skillUpdated: false });
    expect(await eventCount(u, easy, 'read')).toBe(1);
    expect(await row(u, S1)).toMatchObject({ level: 2, points: 0 });
    const hard = await makeArticle(db, { primary: S1, difficulty: 3 });
    expect(await rec(hard, 'read')).toEqual({ recorded: true, skillUpdated: true });
    expect(await row(u, S1)).toMatchObject({ level: 2, points: 1 });
  });

  it('levels up at points_per_level and resets points', async () => {
    await giveSkill(db, u, S1, { level: 2, points: 4 });
    expect(await rec(await makeArticle(db, { primary: S1, difficulty: 2 }), 'read')).toEqual({
      recorded: true,
      skillUpdated: true,
    });
    expect(await row(u, S1)).toMatchObject({ level: 3, points: 0 });
  });

  it('level 4 is the cap: event recorded, nothing changes', async () => {
    await giveSkill(db, u, S1, { level: 4, points: 0 });
    const a = await makeArticle(db, { primary: S1, difficulty: 4 });
    expect(await rec(a, 'read')).toEqual({ recorded: true, skillUpdated: false });
    expect(await row(u, S1)).toMatchObject({ level: 4, points: 0 });
    expect(await eventCount(u, a, 'read')).toBe(1);
  });

  it('a level-null skill counts as level 1', async () => {
    await giveSkill(db, u, S1, { level: null, uncertain: true, points: 0 });
    expect(await rec(await makeArticle(db, { primary: S1, difficulty: 0 }), 'read')).toEqual({
      recorded: true,
      skillUpdated: false,
    });
    expect(await row(u, S1)).toMatchObject({ level: null, points: 0 });
    expect(await rec(await makeArticle(db, { primary: S1, difficulty: 1 }), 'read')).toEqual({
      recorded: true,
      skillUpdated: true,
    });
    expect(await row(u, S1)).toMatchObject({ level: null, points: 1 });
    await db.update(userSkills).set({ points: 4 }).where(eq(userSkills.userId, u));
    await rec(await makeArticle(db, { primary: S1, difficulty: 1 }), 'read');
    expect(await row(u, S1)).toMatchObject({ level: 2, points: 0 });
  });

  it('only the primary skill is affected', async () => {
    await giveSkill(db, u, S1, { level: 2, points: 0 });
    await giveSkill(db, u, S2, { level: 2, points: 0 });
    const before = await row(u, S2);
    const a = await makeArticle(db, { primary: S1, secondary: [S2], difficulty: 2 });
    for (const k of KINDS) await rec(a, k);
    expect(await row(u, S2)).toEqual(before);
    expect(await row(u, S1)).toMatchObject({ points: 1 });
  });

  it('Double-click: 10 parallel identical reads give exactly one point and one event', async () => {
    await giveSkill(db, u, S1, { level: 2, points: 0 });
    const a = await makeArticle(db, { primary: S1, difficulty: 2 });
    const results = await Promise.all(Array.from({ length: 10 }, () => rec(a, 'read')));
    expect(results.filter((r) => r.recorded)).toHaveLength(1);
    expect(results.filter((r) => r.skillUpdated)).toHaveLength(1);
    expect(await row(u, S1)).toMatchObject({ level: 2, points: 1 });
    expect(await eventCount(u, a, 'read')).toBe(1);
  });

  it('parallel reads of 10 different articles: two level-ups, none lost or doubled', async () => {
    await giveSkill(db, u, S1, { level: 1, uncertain: false, points: 0 });
    const ids = await articlesOf(10);
    const results = await Promise.all(ids.map((a) => rec(a, 'read')));
    expect(results.every((r) => r.recorded)).toBe(true);
    expect(await row(u, S1)).toMatchObject({ level: 3, points: 0 });
    expect(await eventCount(u, undefined, 'read')).toBe(10);
  });

  it('parallel reads of 7 different articles: level 2, points 2', async () => {
    await giveSkill(db, u, S1, { level: 1, uncertain: false, points: 0 });
    const ids = await articlesOf(7);
    const results = await Promise.all(ids.map((a) => rec(a, 'read')));
    expect(results.every((r) => r.recorded)).toBe(true);
    expect(await row(u, S1)).toMatchObject({ level: 2, points: 2 });
  });

  it('level cap holds under 12 parallel reads of difficulty-3 articles', async () => {
    await giveSkill(db, u, S1, { level: 3, uncertain: false, points: 0 });
    const ids = await articlesOf(12, S1, 3);
    const results = await Promise.all(ids.map((a) => rec(a, 'read')));
    expect(results.every((r) => r.recorded)).toBe(true);
    expect(results.filter((r) => r.skillUpdated)).toHaveLength(5);
    expect(await row(u, S1)).toMatchObject({ level: 4, points: 0 });
  });
});

describe('too_easy / too_hard', () => {
  beforeEach(async () => {
    await giveSkill(db, u, S1, { level: 2 });
  });

  it('too_easy: 1 -> 0, 2 -> 1, 3 -> 1', async () => {
    const [a1, a2, a3] = (await articlesOf(3)) as [number, number, number];
    expect(await rec(a1, 'too_easy')).toEqual({ recorded: true, skillUpdated: true });
    expect(await offset()).toBe(0);
    expect(await eventCount(u, a1, 'too_easy')).toBe(1);
    await rec(a2, 'too_easy');
    expect(await offset()).toBe(1);
    await rec(a3, 'too_easy');
    expect(await offset()).toBe(1);
  });

  it('too_hard on 2 articles -> -1', async () => {
    const [a1, a2] = (await articlesOf(2)) as [number, number];
    await rec(a1, 'too_hard');
    expect(await offset()).toBe(0);
    await rec(a2, 'too_hard');
    expect(await offset()).toBe(-1);
  });

  it('2 easy then 2 hard -> 1 then 0 (recomputed from events)', async () => {
    const [a1, a2, a3, a4] = (await articlesOf(4)) as [number, number, number, number];
    await rec(a1, 'too_easy');
    await rec(a2, 'too_easy');
    expect(await offset()).toBe(1);
    await rec(a3, 'too_hard');
    expect(await offset()).toBe(0);
    await rec(a4, 'too_hard');
    expect(await offset()).toBe(0);
  });

  it('1 easy + 3 hard: 0, 0, 0, -1', async () => {
    const [a1, a2, a3, a4] = (await articlesOf(4)) as [number, number, number, number];
    const seen: number[] = [];
    await rec(a1, 'too_easy');
    seen.push(await offset());
    for (const a of [a2, a3, a4]) {
      await rec(a, 'too_hard');
      seen.push(await offset());
    }
    expect(seen).toEqual([0, 0, 0, -1]);
  });

  it('events on articles of another primary skill do not count', async () => {
    await giveSkill(db, u, S2, { level: 2 });
    const other = await articlesOf(3, S2);
    for (const a of other) await rec(a, 'too_easy');
    expect(await offset(u, S2)).toBe(1);
    expect(await offset(u, S1)).toBe(0);
    const [mine] = (await articlesOf(1)) as [number];
    await rec(mine, 'too_easy');
    expect(await offset(u, S1)).toBe(0); // 1/3 rounds to 0: S2 events not counted
    // Secondary skill of an article is never affected.
    const sec = await makeArticle(db, { primary: S1, secondary: [S2] });
    await rec(sec, 'too_hard');
    expect(await offset(u, S2)).toBe(1);
  });

  it('a repeat is a no-op; too_easy and too_hard on one article both count', async () => {
    const [a1, a2] = (await articlesOf(2)) as [number, number];
    await rec(a1, 'too_easy');
    await rec(a2, 'too_easy');
    expect(await offset()).toBe(1);
    expect(await rec(a2, 'too_easy')).toEqual({ recorded: false, skillUpdated: false });
    expect(await offset()).toBe(1);
    expect(await eventCount(u, a2, 'too_easy')).toBe(1);
    expect(await rec(a1, 'too_hard')).toEqual({ recorded: true, skillUpdated: true });
    expect(await offset()).toBe(0); // (2 - 1) / 3 rounds to 0
  });

  it('parallel too_easy on 2 different articles -> 1 (no stale count)', async () => {
    const ids = await articlesOf(2);
    const results = await Promise.all(ids.map((a) => rec(a, 'too_easy')));
    expect(results.every((r) => r.recorded && r.skillUpdated)).toBe(true);
    expect(await offset()).toBe(1);
  });

  it('parallel too_hard on 6 different articles -> -1 and 6 events', async () => {
    const ids = await articlesOf(6);
    await Promise.all(ids.map((a) => rec(a, 'too_hard')));
    expect(await offset()).toBe(-1);
    expect(await eventCount(u, undefined, 'too_hard')).toBe(6);
  });
});

describe('quiz marker (Decision 14)', () => {
  const answer = (questionId: string) => ({ questionId, first: 0, second: 1 });

  it('a quiz redo resets the offset for good', async () => {
    await giveSkill(db, u, S1, { level: 2 });
    const [x1, x2, x3, x4] = (await articlesOf(4)) as [number, number, number, number];
    await rec(x1, 'too_easy');
    await rec(x2, 'too_easy');
    expect(await offset()).toBe(1);

    await saveOnboarding(db, {
      userId: u,
      roleSkillIds: [S1, S2],
      results: [{ skillId: S1, level: 2, uncertain: false }],
      answers: [answer(`${S1}-1`), answer(`${S1}-2`)],
      quizVersion: 1,
    });
    expect(await offset()).toBe(0);

    await rec(x3, 'too_easy');
    expect(await offset()).toBe(0); // only x3 counts: 1/3 -> 0, not 3/3 -> 1
    await rec(x4, 'too_easy');
    expect(await offset()).toBe(1); // x3, x4: 2/3 -> 1
    // A new click on an old (pre-redo) article counts: the event's time matters, not the article's.
    await rec(x1, 'too_hard');
    expect(await offset()).toBe(0); // (2 - 1) / 3 -> 0
  });

  it('without quiz answers all events count; answers for another skill do not move the marker', async () => {
    await giveSkill(db, u, S1, { level: 2 });
    const [a1, a2, a3] = (await articlesOf(3)) as [number, number, number];
    await addEvent(db, u, a1, 'too_easy'); // recorded before any quiz
    await rec(a2, 'too_easy');
    expect(await offset()).toBe(1); // both count
    await db.insert(quizAnswers).values([
      { userId: u, questionId: `${S2}-1`, firstOption: 0, secondOption: 1, quizVersion: 1 },
    ]);
    await rec(a3, 'too_hard');
    expect(await offset()).toBe(0); // (2 - 1) / 3: the S2 answer did not hide the S1 events
    const [a4] = (await articlesOf(1)) as [number];
    await rec(a4, 'too_easy');
    expect(await offset()).toBe(1); // (3 - 1) / 3 -> 1
  });

  it('question ids map to skills by the numeric-suffix rule', async () => {
    await giveSkill(db, u, S1, { level: 2 });
    const [a1, a2, a3] = (await articlesOf(3)) as [number, number, number];
    await rec(a1, 'too_easy');
    await rec(a2, 'too_easy');
    expect(await offset()).toBe(1);
    // Ids that only start with S1 belong to other skills (no taxonomy skill shares a prefix, so synthetic).
    await db.insert(quizAnswers).values(
      [`${S1}x-1`, `${S1}-extra-1`, S1].map((questionId) => ({
        userId: u,
        questionId,
        firstOption: 0,
        secondOption: 1,
        quizVersion: 1,
      })),
    );
    await rec(a3, 'too_easy');
    expect(await offset()).toBe(1); // 3/3: marker not moved
    // `${S1}-10` is S1's.
    await db
      .insert(quizAnswers)
      .values({ userId: u, questionId: `${S1}-10`, firstOption: 0, secondOption: 1, quizVersion: 1 });
    const [a4] = (await articlesOf(1)) as [number];
    await rec(a4, 'too_easy');
    expect(await offset()).toBe(0); // only a4 counts: 1/3 -> 0
  });
});

describe('not_interested', () => {
  beforeEach(async () => {
    await giveSkill(db, u, S1, { level: 2, interest: 1 });
  });
  const interest = async () => (await row(u, S1)).interest;

  it('decays by interest_decay and floors at interest_min', async () => {
    const ids = await articlesOf(10);
    expect(await rec(ids[0]!, 'not_interested')).toEqual({ recorded: true, skillUpdated: true });
    expect(await interest()).toBeCloseTo(0.8, 5);
    await rec(ids[1]!, 'not_interested');
    expect(await interest()).toBeCloseTo(0.64, 5);
    for (const a of ids.slice(2)) await rec(a, 'not_interested');
    expect(await interest()).toBeCloseTo(0.2, 5);
  });

  it('the same article twice is a no-op', async () => {
    const [a] = (await articlesOf(1)) as [number];
    await rec(a, 'not_interested');
    expect(await rec(a, 'not_interested')).toEqual({ recorded: false, skillUpdated: false });
    expect(await interest()).toBeCloseTo(0.8, 5);
  });

  it('read and like do not change interest', async () => {
    const [a] = (await articlesOf(1)) as [number];
    await rec(a, 'read');
    await rec(a, 'like');
    expect(await interest()).toBe(1);
  });

  it('parallel not_interested on 3 articles -> 0.512', async () => {
    const ids = await articlesOf(3);
    await Promise.all(ids.map((a) => rec(a, 'not_interested')));
    expect(await interest()).toBeCloseTo(0.512, 5);
  });
});

describe('like', () => {
  it('records the event and changes no user_skills column', async () => {
    await giveSkill(db, u, S1, { level: 2, points: 1, interest: 0.5, difficultyOffset: 1, focusRank: 1 });
    const before = await row(u, S1);
    const [a] = (await articlesOf(1)) as [number];
    expect(await rec(a, 'like')).toEqual({ recorded: true, skillUpdated: false });
    expect(await row(u, S1)).toEqual(before);
    expect(await eventCount(u, a, 'like')).toBe(1);
    expect(await rec(a, 'like')).toEqual({ recorded: false, skillUpdated: false });
  });
});

describe('not onboarded (ruling 1)', () => {
  const skillRows = async (userId = u) => db.select().from(userSkills).where(eq(userSkills.userId, userId));

  it('a user without user_skills rows gets every event recorded and no row created', async () => {
    const [a] = (await articlesOf(1)) as [number];
    for (const k of KINDS) expect(await rec(a, k)).toEqual({ recorded: true, skillUpdated: false });
    expect(await eventCount(u, a)).toBe(5);
    expect(await skillRows()).toHaveLength(0);
  });

  it('a user without a row for the primary skill gets no row for it', async () => {
    await giveSkill(db, u, S2, { level: 2 });
    const before = await skillRows();
    const [a] = (await articlesOf(1)) as [number];
    for (const k of KINDS) expect(await rec(a, k)).toEqual({ recorded: true, skillUpdated: false });
    expect(await eventCount(u, a)).toBe(5);
    expect(await skillRows()).toEqual(before);
  });
});

describe('errors and isolation', () => {
  it('unknown, pending, failed, or primary-less articles throw ArticleNotFoundError and write nothing', async () => {
    await giveSkill(db, u, S1, { level: 2 });
    const pending = await makeArticle(db, { primary: S1, status: 'pending' });
    const failed = await makeArticle(db, { primary: S1, status: 'failed' });
    const noPrimary = await makeArticle(db, { primary: S2, secondary: [S1] });
    await db.delete(articleSkills).where(and(eq(articleSkills.articleId, noPrimary), eq(articleSkills.isPrimary, true)));
    for (const id of [999_999, pending, failed, noPrimary]) {
      for (const k of KINDS) await expect(rec(id, k)).rejects.toBeInstanceOf(ArticleNotFoundError);
    }
    expect(await eventCount()).toBe(0);
    expect(await row(u, S1)).toMatchObject({ points: 0, interest: 1, difficultyOffset: 0 });
  });

  it("another user's rows and events are never touched", async () => {
    const other = await makeUser(db);
    await giveSkill(db, u, S1, { level: 2 });
    await giveSkill(db, other, S1, { level: 2, points: 3, interest: 0.5, difficultyOffset: -1 });
    const [a, b] = (await articlesOf(2)) as [number, number];
    await addEvent(db, other, b, 'too_hard');
    const snapshot = async () => ({
      skills: await db.select().from(userSkills).where(eq(userSkills.userId, other)),
      events: await db
        .select()
        .from(articleEvents)
        .where(eq(articleEvents.userId, other))
        .orderBy(asc(articleEvents.id)),
    });
    const before = await snapshot();
    for (const k of KINDS) await rec(a, k);
    await rec(b, 'too_easy');
    expect(await snapshot()).toEqual(before);
  });

  it('a failing effect rolls back the event insert', async () => {
    await giveSkill(db, u, S1, { level: 2 });
    const [a] = (await articlesOf(1)) as [number];
    await expect(rec(a, 'too_easy', u, { ...cfg, offset_k: 0 })).rejects.toBeInstanceOf(RangeError);
    expect(await eventCount()).toBe(0);
    expect(await offset()).toBe(0);
    // The click can be retried with a valid config.
    expect(await rec(a, 'too_easy')).toEqual({ recorded: true, skillUpdated: true });
  });
});
