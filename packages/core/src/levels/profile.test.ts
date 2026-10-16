import { and, eq } from 'drizzle-orm';
import { profileSchema, type Source, type Taxonomy } from '@attn/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { articleEvents, articles, quizAnswers, userSkills, users, type Db } from '../db';
import { resetDb, testDb } from '../test/db';
import { buildProfile, HISTORY_LIMIT, likeShare, type ProfileContext } from './profile';
import { saveOnboarding } from './store';

const levels = [0, 1, 2, 3, 4].map((level) => ({ level, label: `L${level}`, description: `d${level}` }));
const skill = (id: string, roles: string[] = ['dev']) => ({ id, name: `Name ${id}`, description: 'x', roles });
const taxonomy: Taxonomy = {
  version: 1,
  levels,
  domains: [
    { id: 'd1', name: 'D1', skills: [skill('s1'), skill('s2')] },
    { id: 'd2', name: 'D2', skills: [skill('s3'), skill('x', ['pm'])] },
    { id: 'd3', name: 'D3', skills: [skill('only-pm', ['pm'])] },
  ],
};
const sources = [{ id: 'src', name: 'Source One', type: 'rss', url: 'https://x.test/f' }] as Source[];
const ctx: ProfileContext = { role: 'dev', taxonomy, sources, pointsPerLevel: 5 };
const roleSkillIds = ['s1', 's2', 's3'];

let db: Db;
let u: string;
let ghid = 1;
let artN = 1;

async function newUser(): Promise<string> {
  const [row] = await db.insert(users).values({ githubId: ghid++, login: 'u' }).returning({ id: users.id });
  return row!.id;
}
async function newArticle(sourceId = 'src'): Promise<number> {
  const n = artN++;
  const [row] = await db
    .insert(articles)
    .values({
      sourceId,
      url: `https://x.test/a${n}`,
      guid: `g${n}`,
      title: `Title ${n}`,
      titleHash: `h${n}`,
      publishedAt: new Date(2026, 0, n),
    })
    .returning({ id: articles.id });
  return row!.id;
}
const ev = (userId: string, articleId: number, kind: 'read' | 'like', at: string) =>
  db.insert(articleEvents).values({ userId, articleId, kind, createdAt: new Date(at) });
const skillOf = (p: Awaited<ReturnType<typeof buildProfile>>, id: string) => {
  const s = p.domains.flatMap((d) => d.skills).find((x) => x.id === id);
  if (!s) throw new Error(`no skill ${id}`);
  return s;
};
const onboard = (extra: Partial<Parameters<typeof saveOnboarding>[1]> = {}) =>
  saveOnboarding(db, {
    userId: u,
    roleSkillIds,
    focus: ['s2', 's1'],
    results: [],
    answers: [],
    quizVersion: 1,
    ...extra,
  });

beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
  u = await newUser();
});

describe('likeShare', () => {
  it('is null without reads, else liked / read', () => {
    expect(likeShare(0, 0)).toBeNull();
    expect(likeShare(0, 3)).toBeNull();
    expect(likeShare(4, 1)).toBe(0.25);
    expect(likeShare(2, 2)).toBe(1);
  });
});

describe('buildProfile', () => {
  it('shows a not-onboarded user as unassessed and writes nothing', async () => {
    const p = await buildProfile(db, u, ctx);
    expect(p.onboarded).toBe(false);
    expect(p.focus).toEqual([]);
    expect(p.domains.map((d) => [d.id, d.skills.map((s) => s.id)])).toEqual([
      ['d1', ['s1', 's2']],
      ['d2', ['s3']],
    ]);
    for (const s of p.domains.flatMap((d) => d.skills)) {
      expect(s).toMatchObject({
        level: null,
        effectiveLevel: 1,
        assessed: false,
        quizzed: false,
        uncertain: true,
        points: 0,
        pointsNeeded: 5,
        focusRank: null,
      });
    }
    expect(p.history).toEqual({ items: [], total: 0 });
    expect(p.likes).toEqual({ read: 0, liked: 0, share: null });
    expect(await db.select().from(userSkills)).toEqual([]);
    expect(profileSchema.parse(p)).toEqual(p);
  });

  it('reports focus and quiz results after onboarding', async () => {
    await onboard({
      results: [{ skillId: 's1', level: 3, uncertain: true }],
      answers: [
        { questionId: 's1-1', first: 0, second: 1 },
        { questionId: 's1-2', first: 0, second: 1 },
      ],
    });
    const p = await buildProfile(db, u, ctx);
    expect(p.onboarded).toBe(true);
    expect(p.focus).toEqual([
      { rank: 1, skillId: 's2', name: 'Name s2' },
      { rank: 2, skillId: 's1', name: 'Name s1' },
    ]);
    expect(skillOf(p, 's1')).toMatchObject({
      level: 3,
      effectiveLevel: 3,
      assessed: true,
      quizzed: true,
      uncertain: true,
      pointsNeeded: 5,
      focusRank: 2,
    });
    expect(skillOf(p, 's2')).toMatchObject({ level: null, assessed: false, quizzed: false, focusRank: 1 });
    expect(skillOf(p, 's3').focusRank).toBeNull();
    expect(profileSchema.parse(p)).toEqual(p);
  });

  it('reports progress fields and honours pointsPerLevel', async () => {
    await onboard();
    const set = (skillId: string, v: Partial<typeof userSkills.$inferInsert>) =>
      db
        .update(userSkills)
        .set(v)
        .where(and(eq(userSkills.userId, u), eq(userSkills.skillId, skillId)));
    await set('s1', { level: 2, points: 3, uncertain: false });
    await set('s3', { level: 4 });
    await set('s2', { points: 2 });
    const p = await buildProfile(db, u, ctx);
    expect(skillOf(p, 's1')).toMatchObject({
      points: 3,
      pointsNeeded: 5,
      uncertain: false,
      assessed: true,
      quizzed: false,
    });
    expect(skillOf(p, 's3')).toMatchObject({ level: 4, pointsNeeded: null });
    expect(skillOf(p, 's2')).toMatchObject({ assessed: false, points: 2, pointsNeeded: 5, effectiveLevel: 1 });
    expect(skillOf(await buildProfile(db, u, { ...ctx, pointsPerLevel: 3 }), 's1').pointsNeeded).toBe(3);
  });

  it('maps question ids to skills and ignores ids without a numeric suffix', async () => {
    await onboard();
    const ans = (questionId: string) => ({ userId: u, questionId, firstOption: 0, secondOption: 1, quizVersion: 1 });
    await db.insert(quizAnswers).values([ans('s1-10'), ans('s2'), ans('s3-x')]);
    const p = await buildProfile(db, u, ctx);
    expect(skillOf(p, 's1').quizzed).toBe(true);
    expect(skillOf(p, 's2').quizzed).toBe(false);
    expect(skillOf(p, 's3').quizzed).toBe(false);
  });

  it('maps question ids of hyphenated skill ids to their skill', async () => {
    const tax: Taxonomy = {
      version: 1,
      levels,
      domains: [
        {
          id: 'd1',
          name: 'D1',
          skills: [skill('cc-hooks'), skill('cc-hooks-advanced'), skill('multi-agent-orchestration')],
        },
      ],
    };
    const ids = ['cc-hooks', 'cc-hooks-advanced', 'multi-agent-orchestration'];
    await saveOnboarding(db, {
      userId: u,
      roleSkillIds: ids,
      focus: ['cc-hooks'],
      results: [],
      answers: [],
      quizVersion: 1,
    });
    const ans = (questionId: string) => ({ userId: u, questionId, firstOption: 0, secondOption: 1, quizVersion: 1 });
    await db.insert(quizAnswers).values([ans('cc-hooks-advanced-2'), ans('multi-agent-orchestration-10')]);
    const p = await buildProfile(db, u, { ...ctx, taxonomy: tax });
    expect(skillOf(p, 'cc-hooks').quizzed).toBe(false);
    expect(skillOf(p, 'cc-hooks-advanced').quizzed).toBe(true);
    expect(skillOf(p, 'multi-agent-orchestration').quizzed).toBe(true);
  });

  it('copes with taxonomy drift', async () => {
    await onboard({ roleSkillIds: [...roleSkillIds, 'ghost'], focus: ['ghost', 's1'] });
    await db.delete(userSkills).where(and(eq(userSkills.userId, u), eq(userSkills.skillId, 's3')));
    const p = await buildProfile(db, u, ctx);
    expect(skillOf(p, 's3')).toMatchObject({ level: null, assessed: false, focusRank: null });
    expect(p.domains.flatMap((d) => d.skills.map((s) => s.id))).toEqual(['s1', 's2', 's3']);
    // ranks are renumbered densely at read time: 'ghost' (rank 1) left the taxonomy, so s1 moves up to 1
    expect(p.focus).toEqual([{ rank: 1, skillId: 's1', name: 'Name s1' }]);
    expect(skillOf(p, 's1').focusRank).toBe(1);
  });

  it('renumbers focus densely when a middle focus skill left the taxonomy', async () => {
    await onboard({ roleSkillIds: [...roleSkillIds, 'ghost'], focus: ['s2', 'ghost', 's3', 's1'] });
    const p = await buildProfile(db, u, ctx);
    expect(p.focus.map((f) => [f.rank, f.skillId])).toEqual([
      [1, 's2'],
      [2, 's3'],
      [3, 's1'],
    ]);
    expect([skillOf(p, 's2'), skillOf(p, 's3'), skillOf(p, 's1')].map((s) => s.focusRank)).toEqual([1, 2, 3]);
    const stored = await db
      .select()
      .from(userSkills)
      .where(and(eq(userSkills.userId, u), eq(userSkills.skillId, 's1')));
    expect(stored[0]!.focusRank).toBe(4); // read-only: the stored rank is untouched
  });

  it('builds history and like share from events', async () => {
    await onboard();
    const other = await newUser();
    const [a, b, c, d] = [await newArticle(), await newArticle(), await newArticle(), await newArticle('unknown-src')];
    await ev(u, a, 'read', '2026-03-01T10:00:00Z');
    await ev(u, b, 'read', '2026-03-03T10:00:00Z');
    await ev(u, c, 'read', '2026-03-02T10:00:00Z');
    await ev(u, b, 'like', '2026-03-03T11:00:00Z');
    await ev(u, d, 'like', '2026-03-03T12:00:00Z');
    await ev(other, a, 'read', '2026-03-04T10:00:00Z');
    const p = await buildProfile(db, u, ctx);
    expect(p.history.total).toBe(3);
    expect(p.history.items).toEqual([
      {
        articleId: b,
        title: `Title ${b}`,
        url: `https://x.test/a${b}`,
        sourceName: 'Source One',
        readAt: '2026-03-03T10:00:00.000Z',
      },
      {
        articleId: c,
        title: `Title ${c}`,
        url: `https://x.test/a${c}`,
        sourceName: 'Source One',
        readAt: '2026-03-02T10:00:00.000Z',
      },
      {
        articleId: a,
        title: `Title ${a}`,
        url: `https://x.test/a${a}`,
        sourceName: 'Source One',
        readAt: '2026-03-01T10:00:00.000Z',
      },
    ]);
    expect(p.likes).toEqual({ read: 3, liked: 1, share: 1 / 3 });
    expect(profileSchema.parse(p)).toEqual(p);

    await ev(u, d, 'read', '2026-03-05T10:00:00Z');
    const p2 = await buildProfile(db, u, ctx);
    expect(p2.history.items[0]).toMatchObject({ articleId: d, sourceName: 'unknown-src' });
    expect(p2.likes).toEqual({ read: 4, liked: 2, share: 0.5 });
  });

  it('limits history to the last 20 reads but counts all', async () => {
    await onboard();
    for (let i = 0; i < 25; i++)
      await ev(u, await newArticle(), 'read', new Date(Date.UTC(2026, 3, 1, 0, i)).toISOString());
    const p = await buildProfile(db, u, ctx);
    expect(HISTORY_LIMIT).toBe(20);
    expect(p.history.items).toHaveLength(20);
    expect(p.history.total).toBe(25);
    expect(p.likes.read).toBe(25);
  });
});
