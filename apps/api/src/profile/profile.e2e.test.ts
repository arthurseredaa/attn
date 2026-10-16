import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { articleEvents, loadTaxonomy, roleSkillIds, saveOnboarding, userSkills } from '@attn/core';
import { resetDb } from '@attn/core/testing';
import { errorBodySchema, profileSchema, type Profile } from '@attn/shared';
import { startTestApp, type TestApp } from '../test/app';
import { signIn } from '../test/auth';
import { SEED_SOURCE, seedArticle, skillIds } from '../test/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await startTestApp();
  await resetDb(ctx.db);
});

afterEach(async () => {
  await ctx.close();
});

const getProfile = (headers?: Record<string, string>) => fetch(`${ctx.base}/api/profile`, { headers });
const allSkills = (p: Profile) => p.domains.flatMap((d) => d.skills);

async function onboard(userId: string, level = 3) {
  const [a, b, c] = skillIds(3) as [string, string, string];
  await saveOnboarding(ctx.db, {
    userId,
    roleSkillIds: roleSkillIds(loadTaxonomy(), 'dev'),
    focus: [c, a],
    results: [{ skillId: a, level: level as 3, uncertain: true }],
    answers: [],
    quizVersion: 1,
  });
  return { a, b, c };
}

describe('GET /api/profile', () => {
  it('401 without a cookie', async () => {
    const res = await getProfile();
    expect(res.status).toBe(401);
    const body = errorBodySchema.parse(await res.json());
    expect(body.error).toBe('unauthorized');
  });

  it('401 with a garbage cookie', async () => {
    const res = await getProfile({ cookie: 'attn_session=nope' });
    expect(res.status).toBe(401);
  });

  it('returns an unassessed profile for a never-onboarded user without writing', async () => {
    const { headers } = await signIn(ctx);
    const res = await getProfile(headers);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const p = profileSchema.parse(await res.json());
    expect(p.onboarded).toBe(false);
    expect(p.role).toBe('dev');
    expect(p.focus).toEqual([]);
    const devSkills = roleSkillIds(loadTaxonomy(), 'dev');
    expect(allSkills(p)).toHaveLength(devSkills.length);
    expect(devSkills).toHaveLength(32);
    expect(allSkills(p).every((s) => !s.assessed && !s.quizzed)).toBe(true);
    expect(p.history).toEqual({ items: [], total: 0 });
    expect(p.likes).toEqual({ read: 0, liked: 0, share: null });
    expect(await ctx.db.select().from(userSkills)).toHaveLength(0);
  });

  it('shows focus, level and progress for an onboarded user', async () => {
    const { user, headers } = await signIn(ctx);
    const { a, b, c } = await onboard(user.id);
    const res = await getProfile(headers);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const p = profileSchema.parse(await res.json());
    expect(p.onboarded).toBe(true);
    expect(p.focus.map((f) => [f.rank, f.skillId])).toEqual([
      [1, c],
      [2, a],
    ]);
    const tax = loadTaxonomy();
    const nameOf = (id: string) => tax.domains.flatMap((d) => d.skills).find((s) => s.id === id)?.name;
    expect(p.focus.map((f) => f.name)).toEqual([nameOf(c), nameOf(a)]);
    const skills = allSkills(p);
    const sa = skills.find((s) => s.id === a);
    expect(sa).toMatchObject({ level: 3, uncertain: true, pointsNeeded: 5, assessed: true });
    expect(skills.find((s) => s.id === b)).toMatchObject({ level: null, assessed: false });
  });

  it('builds history and likes from real events, only the caller own', async () => {
    const me = await signIn(ctx);
    const other = await signIn(ctx);
    const articleId = await seedArticle(ctx.db);
    const otherArticle = await seedArticle(ctx.db);
    await ctx.db.insert(articleEvents).values([
      { userId: me.user.id, articleId, kind: 'read' },
      { userId: me.user.id, articleId, kind: 'like' },
      { userId: other.user.id, articleId: otherArticle, kind: 'read' },
      { userId: other.user.id, articleId: otherArticle, kind: 'like' },
    ]);
    const p = profileSchema.parse(await (await getProfile(me.headers)).json());
    expect(p.history.total).toBe(1);
    expect(p.history.items[0]).toMatchObject({ articleId, sourceName: SEED_SOURCE.name });
    expect(p.likes).toEqual({ read: 1, liked: 1, share: 1 });
  });

  it('never shows another user levels', async () => {
    const u1 = await signIn(ctx);
    const u2 = await signIn(ctx);
    const { a } = await onboard(u1.user.id, 3);
    await onboard(u2.user.id, 4);
    const p1 = profileSchema.parse(await (await getProfile(u1.headers)).json());
    const p2 = profileSchema.parse(await (await getProfile(u2.headers)).json());
    expect(allSkills(p1).find((s) => s.id === a)?.level).toBe(3);
    expect(allSkills(p2).find((s) => s.id === a)?.level).toBe(4);
  });
});
