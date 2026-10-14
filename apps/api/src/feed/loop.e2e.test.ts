import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadTaxonomy, roleSkillIds, saveOnboarding, userSkills } from '@attn/core';
import { resetDb } from '@attn/core/testing';
import { feedPageSchema, profileSchema, type EventKind, type FeedPage, type Profile } from '@attn/shared';
import { startTestApp, type TestApp } from '../test/app';
import { signIn } from '../test/auth';
import { seedArticle, skillIds, type SeedArticle } from '../test/seed';

let ctx: TestApp;
let headers: Record<string, string>;
let userId: string;
const [S1, S2] = skillIds(2) as [string, string];

beforeEach(async () => {
  ctx = await startTestApp();
  await resetDb(ctx.db);
  const me = await signIn(ctx);
  headers = me.headers;
  userId = me.user.id;
  await saveOnboarding(ctx.db, {
    userId,
    roleSkillIds: roleSkillIds(loadTaxonomy(), 'dev'),
    focus: [S1],
    results: [{ skillId: S1, level: 2, uncertain: false }],
    answers: [],
    quizVersion: 1,
  });
});

afterEach(async () => {
  await ctx.close();
});

let day = 0;
const seed = (o: SeedArticle = {}) =>
  seedArticle(ctx.db, {
    primary: S1,
    difficulty: 2,
    quality: 3,
    type: 'tutorial',
    publishedAt: new Date(Date.UTC(2026, 0, 1 + day++)),
    ...o,
  });

async function feed(): Promise<FeedPage> {
  const res = await fetch(`${ctx.base}/api/feed`, { headers });
  expect(res.status).toBe(200);
  return feedPageSchema.parse(await res.json());
}
const feedIds = async () => (await feed()).items.map((i) => i.id);

async function profile(): Promise<Profile> {
  const res = await fetch(`${ctx.base}/api/profile`, { headers });
  expect(res.status).toBe(200);
  return profileSchema.parse(await res.json());
}
const skill = async (id = S1) => {
  const s = (await profile()).domains.flatMap((d) => d.skills).find((x) => x.id === id);
  if (!s) throw new Error(`skill ${id} not in profile`);
  return s;
};

const post = (id: number, kind: EventKind) =>
  fetch(`${ctx.base}/api/articles/${id}/events`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ kind }),
  });
async function send(id: number, kind: EventKind) {
  const res = await post(id, kind);
  expect(res.status).toBe(200);
}
const dbSkill = async (id = S1) =>
  (await ctx.db.select().from(userSkills).where(eq(userSkills.userId, userId))).find((r) => r.skillId === id)!;

describe('feed -> events -> profile loop', () => {
  it('removes read articles from the feed and records history newest first', async () => {
    const all: number[] = [];
    for (let i = 0; i < 6; i++) all.push(await seed());
    const newest = all.slice(-3).reverse(); // newest first by date
    expect((await feedIds()).slice(0, 3)).toEqual(newest);
    const read: number[] = [];
    for (const id of newest) {
      await send(id, 'read');
      read.push(id);
      const now = await feedIds();
      for (const r of read) expect(now).not.toContain(r);
    }
    const p = await profile();
    expect(p.history.total).toBe(3);
    expect(p.history.items.map((h) => h.articleId)).toEqual([...read].reverse());
    for (const h of p.history.items) {
      expect(h.title).toMatch(/^Article /);
      expect(h.url).toMatch(/^https:\/\/example\.com\/a\//);
      expect(h.sourceName).toBe('src');
      expect(new Date(h.readAt).toISOString()).toBe(h.readAt);
    }
    const times = p.history.items.map((h) => Date.parse(h.readAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(await skill()).toMatchObject({ points: 3, pointsNeeded: 5 });
  });

  it('reshapes the feed after a level-up', async () => {
    const d2 = [];
    for (let i = 0; i < 6; i++) d2.push(await seed());
    const d3 = await seed({ difficulty: 3 });
    expect(await feedIds()).toContain(d2[5]);
    for (const id of d2.slice(0, 5)) await send(id, 'read');
    expect(await skill()).toMatchObject({ level: 3, points: 0 });
    const ids = await feedIds();
    expect(ids).not.toContain(d2[5]);
    expect(ids).toContain(d3);
  });

  it('computes the like share from read articles only', async () => {
    const unread = await seed();
    expect((await profile()).likes).toEqual({ read: 0, liked: 0, share: null });
    await send(unread, 'like');
    expect((await profile()).likes).toEqual({ read: 0, liked: 0, share: null });

    const reads: number[] = [];
    for (let i = 0; i < 4; i++) reads.push(await seed());
    for (const id of reads) await send(id, 'read');
    expect((await profile()).likes).toEqual({ read: 4, liked: 0, share: 0 });
    await send(reads[0]!, 'like');
    await send(reads[1]!, 'like');
    expect((await profile()).likes).toEqual({ read: 4, liked: 2, share: 0.5 });
  });

  it('not_interested hides the article, keeps level and points, scales interest and keeps order', async () => {
    const a = await seed({ difficulty: 3 });
    const b = await seed({ difficulty: 2 });
    const c = await seed({ difficulty: 3 });
    const d = await seed({ difficulty: 2 });
    const before = await feedIds();
    expect(before).toHaveLength(4);
    const levelBefore = await skill();
    const target = before[1]!;
    await send(target, 'not_interested');
    const after = await feedIds();
    expect(after).toEqual(before.filter((id) => id !== target));
    expect([a, b, c, d]).toContain(target);
    const levelAfter = await skill();
    expect(levelAfter.level).toBe(levelBefore.level);
    expect(levelAfter.points).toBe(levelBefore.points);
    expect((await dbSkill()).interest).toBeCloseTo(0.8, 5);
  });

  it('too_hard lowers the band and too_easy restores it', async () => {
    const d1 = await seed({ difficulty: 1 });
    expect(await feedIds()).not.toContain(d1);
    const hard = [await seed(), await seed()];
    const easy = [await seed(), await seed()];
    await send(hard[0]!, 'too_hard');
    expect(await feedIds()).not.toContain(d1);
    await send(hard[1]!, 'too_hard');
    expect((await dbSkill()).difficultyOffset).toBe(-1);
    expect(await feedIds()).toContain(d1);
    await send(easy[0]!, 'too_easy');
    await send(easy[1]!, 'too_easy');
    expect((await dbSkill()).difficultyOffset).toBe(0);
    expect(await feedIds()).not.toContain(d1);
  });

  it('applies eight parallel reads of one article once', async () => {
    const id = await seed();
    const res = await Promise.all(Array.from({ length: 8 }, () => post(id, 'read')));
    for (const r of res) expect(r.status).toBe(200);
    const p = await profile();
    expect(p.history.total).toBe(1);
    expect(p.likes.read).toBe(1);
    expect(await skill()).toMatchObject({ points: 1 });
  });

  it('ranks background skills only at quality 4, after focus articles', async () => {
    const focus = await seed({ difficulty: 2, quality: 3 });
    await seed({ primary: S2, difficulty: 2, quality: 3 });
    expect(await feedIds()).toEqual([focus]);
    const bg = await seed({ primary: S2, difficulty: 2, quality: 4 });
    expect(await feedIds()).toEqual([focus, bg]);
  });

  it('shows 20 history items out of 25 reads', async () => {
    for (let i = 0; i < 25; i++) await send(await seed(), 'read');
    const p = await profile();
    expect(p.history.total).toBe(25);
    expect(p.history.items).toHaveLength(20);
  });
});
