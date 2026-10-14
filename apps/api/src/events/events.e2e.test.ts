import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { articleEvents, loadTaxonomy, roleSkillIds, saveOnboarding, userSkills } from '@attn/core';
import { resetDb } from '@attn/core/testing';
import { errorBodySchema, eventResponseSchema, type EventKind } from '@attn/shared';
import { startTestApp, type TestApp } from '../test/app';
import { signIn } from '../test/auth';
import { seedArticle, skillIds, type SeedArticle } from '../test/seed';

let ctx: TestApp;
const [S1, S2] = skillIds(2) as [string, string];

beforeEach(async () => {
  ctx = await startTestApp();
  await resetDb(ctx.db);
});

afterEach(async () => {
  await ctx.close();
});

async function onboard(userId: string) {
  await saveOnboarding(ctx.db, {
    userId,
    roleSkillIds: roleSkillIds(loadTaxonomy(), 'dev'),
    focus: [S1],
    results: [{ skillId: S1, level: 2, uncertain: false }],
    answers: [],
    quizVersion: 1,
  });
}

const seed = (o: SeedArticle = {}) => seedArticle(ctx.db, { primary: S1, difficulty: 2, quality: 3, ...o });

const post = (user: { headers: Record<string, string> }, id: string | number, body: unknown) =>
  fetch(`${ctx.base}/api/articles/${id}/events`, {
    method: 'POST',
    headers: { ...user.headers, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const record = async (user: { headers: Record<string, string> }, id: number, kind: EventKind) => {
  const res = await post(user, id, { kind });
  expect(res.status).toBe(200);
  return eventResponseSchema.parse(await res.json());
};

const skillRow = async (userId: string, skillId = S1) =>
  (await ctx.db.select().from(userSkills).where(eq(userSkills.userId, userId))).find((r) => r.skillId === skillId)!;
const eventRows = () => ctx.db.select().from(articleEvents);

describe('POST /api/articles/:id/events', () => {
  it('requires a session and leaves GET /api/articles public', async () => {
    const id = await seed();
    expect((await post({ headers: {} }, id, { kind: 'read' })).status).toBe(401);
    expect((await post({ headers: { cookie: 'attn_session=nope' } }, id, { kind: 'read' })).status).toBe(401);
    expect(await eventRows()).toHaveLength(0);
    expect((await fetch(`${ctx.base}/api/articles`)).status).toBe(200);
  });

  it('records read once and is a no-op on repeat', async () => {
    const me = await signIn(ctx);
    await onboard(me.user.id);
    const id = await seed();
    const res = await post(me, id, { kind: 'read' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(eventResponseSchema.parse(await res.json())).toEqual({ kind: 'read', recorded: true });
    expect((await skillRow(me.user.id)).points).toBe(1);
    expect(await record(me, id, 'read')).toEqual({ kind: 'read', recorded: false });
    expect((await skillRow(me.user.id)).points).toBe(1);
    expect(await eventRows()).toHaveLength(1);
  });

  it('levels up on the fifth read and ignores easy articles', async () => {
    const me = await signIn(ctx);
    await onboard(me.user.id);
    for (let i = 0; i < 5; i++) expect((await record(me, await seed(), 'read')).recorded).toBe(true);
    expect(await skillRow(me.user.id)).toMatchObject({ level: 3, points: 0 });
    const easy = await seed({ difficulty: 1 });
    expect(await record(me, easy, 'read')).toEqual({ kind: 'read', recorded: true });
    expect((await skillRow(me.user.id)).points).toBe(0);
  });

  it('survives 10 parallel identical reads', async () => {
    const me = await signIn(ctx);
    await onboard(me.user.id);
    const id = await seed();
    const bodies = await Promise.all(
      Array.from({ length: 10 }, async () => eventResponseSchema.parse(await (await post(me, id, { kind: 'read' })).json())),
    );
    expect(bodies.filter((b) => b.recorded)).toHaveLength(1);
    expect(bodies.filter((b) => !b.recorded)).toHaveLength(9);
    expect((await skillRow(me.user.id)).points).toBe(1);
  });

  it('applies too_easy and too_hard to the difficulty offset', async () => {
    const me = await signIn(ctx);
    await onboard(me.user.id);
    await record(me, await seed(), 'too_easy');
    expect((await skillRow(me.user.id)).difficultyOffset).toBe(0);
    await record(me, await seed(), 'too_easy');
    expect((await skillRow(me.user.id)).difficultyOffset).toBe(1);
    for (let i = 0; i < 2; i++) await record(me, await seed(), 'too_hard');
    expect((await skillRow(me.user.id)).difficultyOffset).toBe(0);
  });

  it('decays interest on not_interested, once per article', async () => {
    const me = await signIn(ctx);
    await onboard(me.user.id);
    const a = await seed();
    const b = await seed();
    await record(me, a, 'not_interested');
    expect((await skillRow(me.user.id)).interest).toBeCloseTo(0.8);
    await record(me, b, 'not_interested');
    expect((await skillRow(me.user.id)).interest).toBeCloseTo(0.64);
    expect(await record(me, a, 'not_interested')).toEqual({ kind: 'not_interested', recorded: false });
    expect((await skillRow(me.user.id)).interest).toBeCloseTo(0.64);
  });

  it('like changes no skill state', async () => {
    const me = await signIn(ctx);
    await onboard(me.user.id);
    const before = await ctx.db.select().from(userSkills);
    expect(await record(me, await seed(), 'like')).toEqual({ kind: 'like', recorded: true });
    expect(await ctx.db.select().from(userSkills)).toEqual(before);
  });

  it('records for a not-onboarded user without creating skill rows', async () => {
    const me = await signIn(ctx);
    const kinds: EventKind[] = ['read', 'like', 'too_easy', 'too_hard', 'not_interested'];
    for (const kind of kinds) expect(await record(me, await seed(), kind)).toEqual({ kind, recorded: true });
    expect(await eventRows()).toHaveLength(5);
    expect(await ctx.db.select().from(userSkills)).toHaveLength(0);
  });

  it("records for an onboarded user lacking the article's primary-skill row, without skill effects", async () => {
    const me = await signIn(ctx);
    await onboard(me.user.id);
    await ctx.db.delete(userSkills).where(and(eq(userSkills.userId, me.user.id), eq(userSkills.skillId, S2)));
    const before = await ctx.db.select().from(userSkills).where(eq(userSkills.userId, me.user.id));
    expect(before.some((r) => r.skillId === S2)).toBe(false);
    const kinds: EventKind[] = ['read', 'too_easy', 'too_hard', 'not_interested'];
    for (const kind of kinds) {
      expect(await record(me, await seed({ primary: S2, difficulty: 4 }), kind)).toEqual({ kind, recorded: true });
    }
    expect(await eventRows()).toHaveLength(kinds.length);
    expect(await ctx.db.select().from(userSkills).where(eq(userSkills.userId, me.user.id))).toEqual(before);
  });

  it('requires application/json after the session check (415), parameters allowed', async () => {
    const me = await signIn(ctx);
    await onboard(me.user.id);
    const id = await seed();
    const send = (headers: Record<string, string>, body: string) =>
      fetch(`${ctx.base}/api/articles/${id}/events`, { method: 'POST', headers, body });
    // anonymous: 401 wins over 415
    const anon = await send({ 'content-type': 'application/x-www-form-urlencoded' }, 'kind=read');
    expect(anon.status).toBe(401);
    expect(errorBodySchema.parse(await anon.json()).error).toBe('unauthorized');
    for (const type of ['application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data; boundary=x']) {
      const body = type.startsWith('application/x-www') ? 'kind=read' : JSON.stringify({ kind: 'read' });
      const res = await send({ ...me.headers, 'content-type': type }, body);
      expect(res.status, type).toBe(415);
      expect(await res.json(), type).toEqual({ error: 'unsupported_media_type', message: expect.any(String) });
    }
    expect((await send(me.headers, JSON.stringify({ kind: 'read' }))).status).toBe(415);
    expect(await eventRows()).toHaveLength(0);
    const ok = await send({ ...me.headers, 'content-type': 'application/json; charset=utf-8' }, JSON.stringify({ kind: 'read' }));
    expect(ok.status).toBe(200);
    expect(eventResponseSchema.parse(await ok.json())).toEqual({ kind: 'read', recorded: true });
  });

  it('returns 404 for missing, pending and failed articles', async () => {
    const me = await signIn(ctx);
    await onboard(me.user.id);
    const pending = await seed({ status: 'pending' });
    const failed = await seed({ status: 'failed' });
    for (const id of [999999, pending, failed]) {
      const res = await post(me, id, { kind: 'read' });
      expect(res.status).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(errorBodySchema.parse(await res.json()).error).toBe('not_found');
    }
    expect(await eventRows()).toHaveLength(0);
  });

  it('returns 400 for bad ids and bodies', async () => {
    const me = await signIn(ctx);
    await onboard(me.user.id);
    const id = await seed();
    for (const bad of ['abc', '0', '-1', '1.5', '99999999999']) {
      const res = await post(me, bad, { kind: 'read' });
      expect(res.status, bad).toBe(400);
      expect(res.headers.get('cache-control'), bad).toBe('no-store');
      const err = errorBodySchema.parse(await res.json());
      expect(err.error).toBe('bad_request');
      expect(err.message, bad).toMatch(/^params: /);
    }
    for (const body of [{}, { kind: 'share' }, { kind: 'read', extra: 1 }, '{not json', '']) {
      const res = await post(me, id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      // the handler sets no-store before parsing; malformed JSON is refused earlier, by the body parser
      if (body !== '{not json') expect(res.headers.get('cache-control'), JSON.stringify(body)).toBe('no-store');
    }
    expect(await eventRows()).toHaveLength(0);
    expect((await skillRow(me.user.id)).points).toBe(0);
  });

  it('isolates users', async () => {
    const a = await signIn(ctx);
    const b = await signIn(ctx);
    await onboard(a.user.id);
    await onboard(b.user.id);
    const id = await seed();
    await record(a, id, 'not_interested');
    expect((await skillRow(b.user.id)).interest).toBe(1);
    expect((await record(b, id, 'not_interested')).recorded).toBe(true);
    expect((await skillRow(a.user.id)).interest).toBeCloseTo(0.8);
  });

  it('exposes only kind and recorded', async () => {
    const me = await signIn(ctx);
    await onboard(me.user.id);
    const body = (await (await post(me, await seed(), { kind: 'read' })).json()) as object;
    expect(Object.keys(body).sort()).toEqual(['kind', 'recorded']);
  });
});
