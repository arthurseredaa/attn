import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { loadTaxonomy, quizAnswers, userSkills } from '@attn/core';
import { fixtureQuiz, resetDb } from '@attn/core/testing';
import { errorBodySchema, profileSchema, quizResponseSchema, type Profile, type Quiz, type Taxonomy } from '@attn/shared';
import { startTestApp, type TestApp } from '../test/app';
import { signIn } from '../test/auth';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await startTestApp({}, { quiz: fixtureQuiz });
  await resetDb(ctx.db);
});

afterEach(async () => {
  await ctx.close();
});

type H = Record<string, string>;
const call = (method: string, path: string, headers: H = {}, body?: unknown) =>
  fetch(`${ctx.base}/api${path}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const allSkills = (p: Profile) => p.domains.flatMap((d) => d.skills);
const skill = (p: Profile, id: string) => {
  const s = allSkills(p).find((x) => x.id === id);
  if (!s) throw new Error(`no skill ${id}`);
  return s;
};
const rows = (userId: string) => ctx.db.select().from(userSkills).where(eq(userSkills.userId, userId));
const answerRows = (userId: string) => ctx.db.select().from(quizAnswers).where(eq(quizAnswers.userId, userId));
const ranks = async (userId: string) =>
  (await rows(userId))
    .filter((r) => r.focusRank !== null)
    .sort((a, b) => (a.focusRank as number) - (b.focusRank as number))
    .map((r) => r.skillId);

const ceAnswers = [
  { questionId: 'ce-1', first: 0, second: 1 },
  { questionId: 'ce-2', first: 0, second: 2 },
];
const chAnswers = [
  { questionId: 'ch-1', first: 1, second: 3 },
  { questionId: 'ch-2', first: 2, second: 3 },
];
const FOCUS = ['context-engineering', 'cc-hooks'];

async function onboarded() {
  const me = await signIn(ctx);
  const res = await call('POST', '/onboarding', me.headers, { focus: FOCUS, answers: [...ceAnswers, ...chAnswers] });
  expect(res.status).toBe(200);
  return me;
}

function keys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keys(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keys(x, out);
    }
  }
  return out;
}

describe('GET /api/quiz', () => {
  it('401 without a cookie', async () => {
    expect((await call('GET', '/quiz?skills=cc-hooks')).status).toBe(401);
  });

  it('returns the questions without any level', async () => {
    const { headers } = await signIn(ctx);
    const res = await call('GET', '/quiz?skills=cc-hooks', headers);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json: unknown = await res.json();
    const body = quizResponseSchema.parse(json);
    expect(body.version).toBe(7);
    expect(body.questions.map((q) => q.id)).toEqual(['ch-1', 'ch-2']);
    expect(body.unavailable).toEqual([]);
    expect(keys(json)).not.toContain('level');
    expect(JSON.stringify(json)).not.toContain('"level"');
    for (const q of body.questions) {
      expect(q.options.map((o) => o.id).sort()).toEqual(q.options.map((_, i) => i));
      for (const o of q.options) expect(o.text).toBe(`${q.id} option ${o.id}`);
    }
  });

  it('reports skills without questions and dedupes', async () => {
    const { headers } = await signIn(ctx);
    const a = quizResponseSchema.parse(await (await call('GET', '/quiz?skills=evals', headers)).json());
    expect(a.questions).toEqual([]);
    expect(a.unavailable).toEqual(['evals']);
    const b = quizResponseSchema.parse(await (await call('GET', '/quiz?skills=cc-hooks,evals,cc-hooks', headers)).json());
    expect(b.questions.map((q) => q.id)).toEqual(['ch-1', 'ch-2']);
    expect(b.unavailable).toEqual(['evals']);
  });

  it('400 for missing, empty, unknown and other-role skills', async () => {
    const { headers } = await signIn(ctx);
    for (const q of ['', '?skills=', '?skills=nope']) {
      const res = await call('GET', `/quiz${q}`, headers);
      expect(res.status).toBe(400);
      if (q.endsWith('nope')) expect(errorBodySchema.parse(await res.json()).message).toContain('nope');
    }
    const pm = await signIn(ctx, { role: 'pm' });
    expect((await call('GET', '/quiz?skills=cc-hooks', pm.headers)).status).toBe(400);
  });
});

describe('POST /api/onboarding', () => {
  it('scores, saves and returns the profile', async () => {
    const me = await signIn(ctx);
    const res = await call('POST', '/onboarding', me.headers, { focus: FOCUS, answers: [...ceAnswers, ...chAnswers] });
    expect(res.status).toBe(200);
    const p = profileSchema.parse(await res.json());
    expect(p.onboarded).toBe(true);
    expect(p.focus.map((f) => [f.rank, f.skillId])).toEqual([
      [1, 'context-engineering'],
      [2, 'cc-hooks'],
    ]);
    expect(skill(p, 'context-engineering')).toMatchObject({ level: 2, uncertain: true, assessed: true });
    expect(skill(p, 'cc-hooks')).toMatchObject({ level: 3, uncertain: false });
    expect(allSkills(p).filter((s) => !s.assessed)).toHaveLength(30);
    expect(await rows(me.user.id)).toHaveLength(32);
    const qa = await answerRows(me.user.id);
    expect(qa).toHaveLength(4);
    expect(qa.every((r) => r.quizVersion === 7)).toBe(true);
  });

  it('allows skipping the quiz', async () => {
    const { headers } = await signIn(ctx);
    const p = profileSchema.parse(await (await call('POST', '/onboarding', headers, { focus: ['evals'], answers: [] })).json());
    expect(p.focus.map((f) => f.skillId)).toEqual(['evals']);
    expect(allSkills(p).every((s) => !s.assessed && s.uncertain)).toBe(true);
  });

  it('redo resets points and moves focus, keeps other skills', async () => {
    const me = await onboarded();
    await ctx.db
      .update(userSkills)
      .set({ points: 3, difficultyOffset: 1 })
      .where(and(eq(userSkills.userId, me.user.id), eq(userSkills.skillId, 'context-engineering')));
    const res = await call('POST', '/onboarding', me.headers, {
      focus: ['cc-hooks'],
      answers: [
        { questionId: 'ce-1', first: 2, second: 4 },
        { questionId: 'ce-2', first: 3, second: 0 },
      ],
    });
    const p = profileSchema.parse(await res.json());
    expect(skill(p, 'context-engineering')).toMatchObject({ level: 4, uncertain: false, focusRank: null });
    expect(skill(p, 'cc-hooks')).toMatchObject({ level: 3, focusRank: 1 });
    const row = (await rows(me.user.id)).find((r) => r.skillId === 'context-engineering');
    expect(row).toMatchObject({ points: 0, difficultyOffset: 0 });
    const qa = await answerRows(me.user.id);
    expect(qa).toHaveLength(4);
    expect(qa.find((r) => r.questionId === 'ce-1')).toMatchObject({ firstOption: 2, secondOption: 4 });
  });

  it('quiz-only retake keeps focus; 422 for a never-onboarded user', async () => {
    const me = await onboarded();
    const retake = [
      { questionId: 'ch-1', first: 0, second: 1 },
      { questionId: 'ch-2', first: 3, second: 1 },
    ];
    const p = profileSchema.parse(await (await call('POST', '/onboarding', me.headers, { answers: retake })).json());
    expect(p.focus.map((f) => f.skillId)).toEqual(FOCUS);
    expect(skill(p, 'cc-hooks')).toMatchObject({ level: 1 });
    const fresh = await signIn(ctx);
    const res = await call('POST', '/onboarding', fresh.headers, { answers: retake });
    expect(res.status).toBe(422);
    expect(await rows(fresh.user.id)).toHaveLength(0);
    expect(await answerRows(fresh.user.id)).toHaveLength(0);
  });

  it('400 for malformed shapes', async () => {
    const { headers } = await signIn(ctx);
    const f = ['evals'];
    const bad: unknown[] = [
      [],
      'x',
      { focus: [], answers: [] },
      { focus: ['a', 'b', 'c', 'd', 'e', 'f'], answers: [] },
      { focus: ['evals', 'evals'], answers: [] },
      { focus: f },
      { focus: f, answers: [{ questionId: 'ce-1', first: -1, second: 1 }] },
      { focus: f, answers: [], extra: 1 },
    ];
    for (const b of bad) expect((await call('POST', '/onboarding', headers, b)).status).toBe(400);
  });

  it('422 and no rows for bad domain input', async () => {
    const me = await signIn(ctx);
    const pm = await signIn(ctx, { role: 'pm' });
    const f = ['context-engineering'];
    const cases: [typeof me, unknown][] = [
      [me, { focus: ['nope'], answers: [] }],
      [me, { focus: f, answers: [{ questionId: 'ce-1', first: 1, second: 1 }, ceAnswers[1]] }],
      [me, { focus: f, answers: [{ questionId: 'ce-1', first: 9, second: 1 }, ceAnswers[1]] }],
      [me, { focus: f, answers: [{ questionId: 'zz-1', first: 0, second: 1 }] }],
      [me, { focus: f, answers: [ceAnswers[0], ceAnswers[0]] }],
      [me, { focus: f, answers: [ceAnswers[0]] }],
      [pm, { focus: f, answers: [] }],
    ];
    for (const [who, body] of cases) {
      const res = await call('POST', '/onboarding', who.headers, body);
      expect(res.status).toBe(422);
      const msg = errorBodySchema.parse(await res.json()).message;
      expect(msg.toLowerCase()).not.toContain('level');
    }
    for (const u of [me, pm]) {
      expect(await rows(u.user.id)).toHaveLength(0);
      expect(await answerRows(u.user.id)).toHaveLength(0);
    }
  });

  it('422 for answers to a skill outside the role', async () => {
    await ctx.close();
    const base = loadTaxonomy();
    const taxonomy: Taxonomy = {
      ...base,
      domains: base.domains.map((d, i) =>
        i === 0 ? { ...d, skills: [...d.skills, { id: 'pm-only', name: 'PM', description: 'x', roles: ['pm'] }] } : d,
      ),
    };
    const opts = [0, 1, 2, 3].map((level) => ({ text: `o${level}`, level: level as 0 | 1 | 2 | 3 }));
    const quiz: Quiz = {
      ...fixtureQuiz,
      questions: [
        ...fixtureQuiz.questions,
        { id: 'po-1', skill_id: 'pm-only', situation: 's', options: opts },
        { id: 'po-2', skill_id: 'pm-only', situation: 's', options: opts },
      ],
    };
    ctx = await startTestApp({}, { quiz, taxonomy });
    await resetDb(ctx.db);
    const me = await signIn(ctx);
    const res = await call('POST', '/onboarding', me.headers, {
      focus: ['evals'],
      answers: [
        { questionId: 'po-1', first: 0, second: 1 },
        { questionId: 'po-2', first: 0, second: 1 },
      ],
    });
    expect(res.status).toBe(422);
    expect(errorBodySchema.parse(await res.json()).message).toBe('Skill not in your role: pm-only');
    expect(await rows(me.user.id)).toHaveLength(0);
    expect(await answerRows(me.user.id)).toHaveLength(0);
  });

  it('401 and nothing written when unauthenticated', async () => {
    const res = await call('POST', '/onboarding', {}, { focus: ['evals'], answers: [] });
    expect(res.status).toBe(401);
    expect(await ctx.db.select().from(userSkills)).toHaveLength(0);
  });

  it('distinguishes malformed JSON from schema errors', async () => {
    const { headers } = await signIn(ctx);
    const bad = await fetch(`${ctx.base}/api/onboarding`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: '{"focus": nope',
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'bad_request', message: 'Malformed JSON body' });
    const invalid = await call('POST', '/onboarding', headers, { focus: [], answers: [] });
    expect(invalid.status).toBe(400);
    const body = errorBodySchema.parse(await invalid.json());
    expect(body.message).not.toBe('Malformed JSON body');
    expect(body.message).toContain('focus');
  });
});

describe('PUT /api/focus', () => {
  it('409 before onboarding, nothing written', async () => {
    const { user, headers } = await signIn(ctx);
    const res = await call('PUT', '/focus', headers, { focus: ['evals'] });
    expect(res.status).toBe(409);
    expect(errorBodySchema.parse(await res.json()).error).toBe('conflict');
    expect(await rows(user.id)).toHaveLength(0);
  });

  it('swaps, shrinks and grows without unique violations', async () => {
    const me = await onboarded();
    const put = async (focus: string[]) => {
      const res = await call('PUT', '/focus', me.headers, { focus });
      expect(res.status).toBe(200);
      return profileSchema.parse(await res.json());
    };
    const swapped = await put(['cc-hooks', 'context-engineering']);
    expect(swapped.focus.map((f) => f.skillId)).toEqual(['cc-hooks', 'context-engineering']);
    const one = await put(['evals']);
    expect(one.focus.map((f) => f.skillId)).toEqual(['evals']);
    expect(skill(one, 'cc-hooks').focusRank).toBeNull();
    const five = ['evals', 'cc-hooks', 'context-engineering', 'cc-skills-commands', 'cc-plugins'];
    const p5 = await put(five);
    expect(p5.focus.map((f) => [f.rank, f.skillId])).toEqual(five.map((s, i) => [i + 1, s]));
    expect(await ranks(me.user.id)).toEqual(five);
  });

  it('400 for bad shapes, 422 for unknown skill, focus intact afterwards', async () => {
    const me = await onboarded();
    const bad: unknown[] = [{ focus: [] }, { focus: ['a', 'b', 'c', 'd', 'e', 'f'] }, { focus: ['evals', 'evals'] }, {}];
    for (const b of bad) expect((await call('PUT', '/focus', me.headers, b)).status).toBe(400);
    expect((await call('PUT', '/focus', me.headers)).status).toBe(400);
    expect((await call('PUT', '/focus', me.headers, { focus: ['nope'] })).status).toBe(422);
    expect(await ranks(me.user.id)).toEqual(FOCUS);
  });

  it('serializes concurrent edits', async () => {
    const me = await onboarded();
    const a = ['evals', 'cc-hooks'];
    const b = ['cc-skills-commands', 'cc-plugins', 'evals'];
    const [ra, rb] = await Promise.all([
      call('PUT', '/focus', me.headers, { focus: a }),
      call('PUT', '/focus', me.headers, { focus: b }),
    ]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    expect([a, b]).toContainEqual(await ranks(me.user.id));
  });

  it('never touches another user', async () => {
    const me = await onboarded();
    const other = await onboarded();
    await call('PUT', '/focus', me.headers, { focus: ['evals'] });
    expect(await ranks(other.user.id)).toEqual(FOCUS);
  });
});
