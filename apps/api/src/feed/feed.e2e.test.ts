import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { articleEvents, loadTaxonomy, roleSkillIds, saveOnboarding, userSkills } from '@attn/core';
import { resetDb } from '@attn/core/testing';
import { articleCardSchema, errorBodySchema, feedPageSchema, type Config, type FeedPage } from '@attn/shared';
import { startTestApp, type TestApp } from '../test/app';
import { signIn } from '../test/auth';
import { seedArticle, skillIds, type SeedArticle } from '../test/seed';
import { APP_CONFIG } from '../tokens';

let ctx: TestApp;
const [S1, S2] = skillIds(2) as [string, string];

beforeEach(async () => {
  ctx = await startTestApp();
  await resetDb(ctx.db);
});

afterEach(async () => {
  await ctx.close();
});

async function onboard(
  userId: string,
  focus: string[] = [S1],
  results = [{ skillId: S1, level: 2, uncertain: false }],
) {
  await saveOnboarding(ctx.db, {
    userId,
    roleSkillIds: roleSkillIds(loadTaxonomy(), 'dev'),
    focus,
    results,
    answers: [],
    quizVersion: 1,
  });
}

const seed = (o: SeedArticle = {}) =>
  seedArticle(ctx.db, { primary: S1, difficulty: 2, quality: 3, type: 'tutorial', ...o });

async function getFeed(headers: Record<string, string>, qs = '') {
  const res = await fetch(`${ctx.base}/api/feed${qs}`, { headers });
  return { res, body: (await res.json()) as unknown };
}

const feed = async (headers: Record<string, string>, qs = ''): Promise<FeedPage> => {
  const r = await getFeed(headers, qs);
  expect(r.res.status).toBe(200);
  return feedPageSchema.parse(r.body);
};
const ids = (p: FeedPage) => p.items.map((i) => i.id);

describe('GET /api/feed', () => {
  it('requires a session', async () => {
    const r = await getFeed({});
    expect(r.res.status).toBe(401);
    expect(errorBodySchema.parse(r.body).error).toBe('unauthorized');
    const g = await getFeed({ cookie: 'attn_session=nope' });
    expect(g.res.status).toBe(401);
  });

  it('gives a never-onboarded user an empty page and writes nothing', async () => {
    const me = await signIn(ctx);
    await seed();
    expect(await feed(me.headers)).toEqual({ items: [], nextOffset: null });
    expect(await ctx.db.select().from(userSkills)).toHaveLength(0);
  });

  it('ranks eligible articles, hides ineligible ones, and keeps cards free of user data', async () => {
    const me = await signIn(ctx);
    await onboard(me.user.id);
    const d2 = await seed({ difficulty: 2 });
    // older than d2: on equal scores the date tie-break would put d2 first, so only d3's higher fit (1.0 vs 0.8) puts it first
    const d3 = await seed({ difficulty: 3, publishedAt: new Date('2026-01-01T00:00:00.000Z') });
    await seed({ difficulty: 0 });
    await seed({ quality: 1 });
    await seed({ status: 'pending' });
    await seed({ primary: S2, quality: 3 });
    const r = await getFeed(me.headers);
    expect(r.res.headers.get('cache-control')).toBe('no-store');
    const page = feedPageSchema.parse(r.body);
    expect(ids(page)).toEqual([d3, d2]);
    for (const c of page.items) expect(Object.keys(c).sort()).toEqual(Object.keys(articleCardSchema.shape).sort());
  });

  it('pages by offset', async () => {
    const me = await signIn(ctx);
    await onboard(me.user.id);
    for (let i = 0; i < 25; i++) await seed({ publishedAt: new Date(Date.UTC(2026, 5, 1 + i)) });
    const p1 = await feed(me.headers);
    expect(p1.items).toHaveLength(20);
    expect(p1.nextOffset).toBe(20);
    const p2 = await feed(me.headers, '?offset=20');
    expect(p2.items).toHaveLength(5);
    expect(p2.nextOffset).toBeNull();
    const all = [...ids(p1), ...ids(p2)];
    expect(new Set(all).size).toBe(25);
    const dates = [...p1.items, ...p2.items].map((i) => i.publishedAt);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(await feed(me.headers, '?offset=25')).toEqual({ items: [], nextOffset: null });
  });

  it('has no next page for exactly 20 articles', async () => {
    const me = await signIn(ctx);
    await onboard(me.user.id);
    for (let i = 0; i < 20; i++) await seed({ publishedAt: new Date(Date.UTC(2026, 5, 1 + i)) });
    const p = await feed(me.headers);
    expect(p.items).toHaveLength(20);
    expect(p.nextOffset).toBeNull();
  });

  it('takes the page size from config', async () => {
    ctx.moduleRef.get<Config>(APP_CONFIG, { strict: false }).page_size = 3;
    const me = await signIn(ctx);
    await onboard(me.user.id);
    for (let i = 0; i < 5; i++) await seed({ publishedAt: new Date(Date.UTC(2026, 5, 1 + i)) });
    const p = await feed(me.headers);
    expect(p.items).toHaveLength(3);
    expect(p.nextOffset).toBe(3);
  });

  it.each(['offset=-1', 'offset=abc', 'offset=1.5', 'offset=', 'offset=10001', 'offset=1&offset=2'])(
    'rejects %s with 400',
    async (qs) => {
      const me = await signIn(ctx);
      await onboard(me.user.id);
      const r = await getFeed(me.headers, `?${qs}`);
      expect(r.res.status).toBe(400);
      errorBodySchema.parse(r.body);
    },
  );

  it('isolates users and applies read events per user', async () => {
    const a = await signIn(ctx);
    const b = await signIn(ctx);
    await onboard(a.user.id);
    await onboard(b.user.id, [S2], [{ skillId: S2, level: 2, uncertain: false }]);
    const x = await seed();
    const y = await seed({ primary: S2 });
    expect(ids(await feed(a.headers))).toEqual([x]);
    expect(ids(await feed(b.headers))).toEqual([y]);
    await ctx.db.insert(articleEvents).values({ userId: a.user.id, articleId: x, kind: 'read' });
    expect(ids(await feed(a.headers))).toEqual([]);
    expect(ids(await feed(b.headers))).toEqual([y]);
  });

  describe('skill and q filters', () => {
    it('any-match on primary or secondary, title search, combined', async () => {
      const me = await signIn(ctx);
      await onboard(
        me.user.id,
        [S1, S2],
        [
          { skillId: S1, level: 2, uncertain: false },
          { skillId: S2, level: 2, uncertain: false },
        ],
      );
      const a = await seed({ primary: S1, title: 'Agents 101' });
      const b = await seed({ primary: S2, secondary: [S1], title: 'Evals 100%' });
      const c = await seed({ primary: S2, title: 'Agents at scale' });
      const sorted = async (qs: string) => ids(await feed(me.headers, qs)).sort((x, y) => x - y);
      expect(await sorted('')).toEqual([a, b, c]);
      expect(await sorted(`?skill=${S1}`)).toEqual([a, b]); // b via its secondary skill
      expect(await sorted(`?skill=${S1}&skill=${S2}`)).toEqual([a, b, c]);
      expect(await sorted('?q=AGENTS')).toEqual([a, c]);
      expect(await sorted('?q=%25')).toEqual([b]);
      expect(await sorted(`?skill=${S2}&q=agents`)).toEqual([c]);
      expect(await sorted('?q=%20')).toEqual([a, b, c]);
    });

    it('400 for an unknown skill, an over-long q or more than 10 skills', async () => {
      const me = await signIn(ctx);
      await onboard(me.user.id);
      for (const [qs, field] of [
        ['?skill=nope', 'skill'],
        [`?skill=${S1}&skill=nope`, 'skill'],
        [`?q=${'x'.repeat(101)}`, 'q'],
        [`?${Array.from({ length: 11 }, (_, i) => `skill=s${i}`).join('&')}`, 'skill'],
      ] as const) {
        const r = await getFeed(me.headers, qs);
        expect(r.res.status).toBe(400);
        expect(errorBodySchema.parse(r.body).message).toContain(field);
      }
    });

    it('offset paging with filters continues the same filtered list (served minus excluded)', async () => {
      const me = await signIn(ctx);
      await onboard(
        me.user.id,
        [S1, S2],
        [
          { skillId: S1, level: 2, uncertain: false },
          { skillId: S2, level: 2, uncertain: false },
        ],
      );
      const pageSize = 3;
      ctx.moduleRef.get<Config>(APP_CONFIG, { strict: false }).page_size = pageSize;
      const total = pageSize + 3;
      for (let i = 0; i < total; i++) {
        await seed({ primary: S1, title: `Match ${i}`, publishedAt: new Date(Date.UTC(2026, 0, 1, 0, i)) });
        await seed({ primary: S2, title: `Match other ${i}`, publishedAt: new Date(Date.UTC(2026, 0, 2, 0, i)) });
      }
      const qs = `skill=${S1}&q=match`;
      const p1 = await feed(me.headers, `?${qs}`);
      expect(p1.items).toHaveLength(pageSize);
      expect(p1.nextOffset).toBe(pageSize);
      // the user reads one served card: the next offset is served - excluded
      await ctx.db.insert(articleEvents).values({ userId: me.user.id, articleId: p1.items[0]!.id, kind: 'read' });
      const p2 = await feed(me.headers, `?${qs}&offset=${pageSize - 1}`);
      expect(p2.items).toHaveLength(3);
      expect(new Set([...ids(p1), ...ids(p2)]).size).toBe(pageSize + 3);
      expect(p2.items.every((i) => i.skills.some((s) => s.id === S1))).toBe(true);
      expect(p2.nextOffset).toBeNull();
    });
  });

  it('exposes no user data keys anywhere', async () => {
    const me = await signIn(ctx);
    await onboard(me.user.id);
    await seed();
    const r = await getFeed(me.headers);
    const banned = new Set(['level', 'interest', 'points', 'score', 'userId']);
    const scan = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(scan);
      else if (v && typeof v === 'object')
        for (const [k, val] of Object.entries(v)) {
          expect(banned.has(k)).toBe(false);
          scan(val);
        }
    };
    scan(r.body);
  });
});
