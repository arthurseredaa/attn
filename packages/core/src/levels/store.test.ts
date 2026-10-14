import { asc, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { quizAnswers, userSkills, users, type Db } from '../db';
import { resetDb, testDb } from '../test/db';
import { FocusError } from './role';
import { FOCUS_LOCK_NAMESPACE, FocusBusyError, isOnboarded, lockUser, NotOnboardedError, saveOnboarding, setFocus } from './store';

const roles = ['s1', 's2', 's3', 's4', 's5', 's6'];
const ver = 7;

let db: Db;
let u: string;
let nextGithubId = 1;

async function newUser(): Promise<string> {
  const [row] = await db.insert(users).values({ githubId: nextGithubId++, login: 'u' }).returning({ id: users.id });
  return row!.id;
}

async function rows(userId: string) {
  return db.select().from(userSkills).where(eq(userSkills.userId, userId)).orderBy(asc(userSkills.skillId));
}

async function rowOf(userId: string, skillId: string) {
  const r = (await rows(userId)).find((x) => x.skillId === skillId);
  if (!r) throw new Error(`no row ${skillId}`);
  return r;
}

async function ranks(userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const r of await rows(userId)) if (r.focusRank !== null) out[r.skillId] = r.focusRank;
  return out;
}

const base = () => ({ userId: u, roleSkillIds: roles, results: [], answers: [], quizVersion: ver });

beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
  u = await newUser();
});

describe('isOnboarded', () => {
  it('is false for a new user and true after saveOnboarding', async () => {
    expect(await isOnboarded(db, u)).toBe(false);
    await saveOnboarding(db, { ...base(), focus: ['s1'] });
    expect(await isOnboarded(db, u)).toBe(true);
  });
});

describe('saveOnboarding', () => {
  it('creates unassessed rows for every role skill and sets focus ranks', async () => {
    await saveOnboarding(db, { ...base(), focus: ['s3', 's1'] });
    const all = await rows(u);
    expect(all.map((r) => r.skillId)).toEqual(roles);
    expect(await ranks(u)).toEqual({ s3: 1, s1: 2 });
    for (const r of all) {
      expect(r).toMatchObject({ level: null, uncertain: true, points: 0, interest: 1, difficultyOffset: 0 });
    }
    expect(await db.select().from(quizAnswers)).toEqual([]);
  });

  it('stores quiz results and answers', async () => {
    await saveOnboarding(db, {
      ...base(),
      focus: ['s1'],
      results: [{ skillId: 's1', level: 2, uncertain: false }],
      answers: [
        { questionId: 's1-1', first: 2, second: 0 },
        { questionId: 's1-2', first: 1, second: 3 },
      ],
    });
    expect(await rowOf(u, 's1')).toMatchObject({ level: 2, uncertain: false });
    for (const id of ['s2', 's3', 's4', 's5', 's6']) {
      expect(await rowOf(u, id)).toMatchObject({ level: null, uncertain: true });
    }
    const a = await db.select().from(quizAnswers).orderBy(asc(quizAnswers.questionId));
    expect(a.map((x) => [x.questionId, x.firstOption, x.secondOption, x.quizVersion])).toEqual([
      ['s1-1', 2, 0, 7],
      ['s1-2', 1, 3, 7],
    ]);
  });

  it('redo resets calibration of re-scored skills only and overwrites answers', async () => {
    await saveOnboarding(db, {
      ...base(),
      focus: ['s1'],
      results: [{ skillId: 's1', level: 2, uncertain: false }],
      answers: [
        { questionId: 's1-1', first: 2, second: 0 },
        { questionId: 's1-2', first: 1, second: 3 },
      ],
    });
    await db.update(userSkills).set({ points: 3, difficultyOffset: 1, interest: 0.6 }).where(eq(userSkills.skillId, 's1'));
    await db.update(userSkills).set({ level: 4, points: 2, difficultyOffset: -1 }).where(eq(userSkills.skillId, 's2'));

    await saveOnboarding(db, {
      ...base(),
      focus: ['s2'],
      results: [{ skillId: 's1', level: 3, uncertain: true }],
      answers: [
        { questionId: 's1-1', first: 0, second: 1 },
        { questionId: 's1-2', first: 3, second: 2 },
      ],
    });
    expect(await rowOf(u, 's1')).toMatchObject({ level: 3, uncertain: true, points: 0, difficultyOffset: 0, interest: 0.6, focusRank: null });
    expect(await rowOf(u, 's2')).toMatchObject({ level: 4, points: 2, difficultyOffset: -1, focusRank: 1 });
    const a = await db.select().from(quizAnswers).orderBy(asc(quizAnswers.questionId));
    expect(a.map((x) => [x.questionId, x.firstOption, x.secondOption])).toEqual([
      ['s1-1', 0, 1],
      ['s1-2', 3, 2],
    ]);
  });

  it.each([
    ['empty', []],
    ['duplicate', ['s1', 's1']],
    ['too many', ['s1', 's2', 's3', 's4', 's5', 's6']],
    ['unknown', ['nope']],
  ])('rejects invalid focus (%s) and writes nothing', async (_n, focus) => {
    await expect(saveOnboarding(db, { ...base(), focus })).rejects.toBeInstanceOf(FocusError);
    expect(await rows(u)).toEqual([]);
  });

  it('rejects a result outside the role and rolls back', async () => {
    await expect(
      saveOnboarding(db, { ...base(), focus: ['s1'], results: [{ skillId: 'zzz', level: 1, uncertain: false }] }),
    ).rejects.toThrow();
    expect(await rows(u)).toEqual([]);
  });

  it('rolls back everything when the answers upsert fails mid-transaction', async () => {
    await expect(
      saveOnboarding(db, {
        ...base(),
        focus: ['s1'],
        results: [{ skillId: 's1', level: 2, uncertain: false }],
        answers: [
          { questionId: 's1-1', first: 1, second: 0 },
          { questionId: 's1-1', first: 2, second: 0 },
        ],
      }),
    ).rejects.toThrow();
    expect(await rows(u)).toEqual([]);
    expect(await db.select().from(quizAnswers)).toEqual([]);
  });

  it('rejects a never-onboarded user without focus with FocusError and writes nothing', async () => {
    const attempt = saveOnboarding(db, {
      ...base(),
      results: [{ skillId: 's1', level: 2, uncertain: false }],
      answers: [
        { questionId: 's1-1', first: 2, second: 0 },
        { questionId: 's1-2', first: 1, second: 3 },
      ],
    });
    await expect(attempt).rejects.toBeInstanceOf(FocusError);
    await expect(attempt).rejects.toMatchObject({ code: 'empty', message: 'Pick a focus first' });
    expect(await rows(u)).toEqual([]);
    expect(await db.select().from(quizAnswers)).toEqual([]);
  });

  it('leaves ranks untouched when focus is undefined', async () => {
    await saveOnboarding(db, { ...base(), focus: ['s1', 's2'] });
    await saveOnboarding(db, { ...base(), results: [{ skillId: 's3', level: 1, uncertain: false }] });
    expect(await rowOf(u, 's3')).toMatchObject({ level: 1, uncertain: false });
    expect(await ranks(u)).toEqual({ s1: 1, s2: 2 });
  });
});

describe('setFocus', () => {
  it('rejects a not-onboarded user with NotOnboardedError and writes nothing', async () => {
    await expect(setFocus(db, u, ['s1'], roles)).rejects.toBeInstanceOf(NotOnboardedError);
    expect(await rows(u)).toEqual([]);
  });

  it('swaps ranks without a unique violation', async () => {
    await saveOnboarding(db, { ...base(), focus: ['s1', 's2'] });
    await setFocus(db, u, ['s2', 's1'], roles);
    expect(await ranks(u)).toEqual({ s2: 1, s1: 2 });
  });

  it('shrinks, grows and rejects bad focus leaving the previous one intact', async () => {
    await saveOnboarding(db, { ...base(), focus: ['s1', 's2'] });
    await setFocus(db, u, ['s1'], roles);
    expect(await ranks(u)).toEqual({ s1: 1 });
    await setFocus(db, u, ['s5', 's4', 's3', 's2', 's1'], roles);
    expect(await ranks(u)).toEqual({ s5: 1, s4: 2, s3: 3, s2: 4, s1: 5 });
    for (const bad of [['s1', 's2', 's3', 's4', 's5', 's6'], ['nope'], ['s1', 's1']]) {
      await expect(setFocus(db, u, bad, roles)).rejects.toBeInstanceOf(FocusError);
    }
    expect(await ranks(u)).toEqual({ s5: 1, s4: 2, s3: 3, s2: 4, s1: 5 });
  });

  it('recreates a missing role-skill row', async () => {
    await saveOnboarding(db, { ...base(), focus: ['s1'] });
    await db.delete(userSkills).where(eq(userSkills.skillId, 's6'));
    await setFocus(db, u, ['s1', 's6'], roles);
    expect(await rowOf(u, 's6')).toMatchObject({ focusRank: 2, level: null });
  });

  it('serializes concurrent edits into one valid shape', async () => {
    await saveOnboarding(db, { ...base(), focus: ['s1', 's2', 's3'] });
    const a = ['s3', 's2', 's1'];
    const b = ['s1', 's4'];
    await Promise.all(Array.from({ length: 20 }, (_, i) => setFocus(db, u, i % 2 === 0 ? a : b, roles)));
    const r = await ranks(u);
    const isA = (r.s3 === 1 && r.s2 === 2 && r.s1 === 3 && Object.keys(r).length === 3);
    const isB = r.s1 === 1 && r.s4 === 2 && Object.keys(r).length === 2;
    expect(isA || isB).toBe(true);
  });
});

describe('concurrency (per-user focus lock)', () => {
  const A = ['s3', 's2', 's1'];
  const B = ['s1', 's4'];
  const isExactly = (r: Record<string, number>, focus: string[]) =>
    Object.keys(r).length === focus.length && focus.every((id, i) => r[id] === i + 1);

  it('serializes racing first onboardings of one user', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        saveOnboarding(db, {
          ...base(),
          focus: i % 2 === 0 ? A : B,
          results: [{ skillId: 's5', level: (i % 4) as 0 | 1 | 2 | 3, uncertain: false }],
          answers: [
            { questionId: 's5-1', first: i % 4, second: 4 },
            { questionId: 's5-2', first: i % 4, second: 4 },
          ],
        }),
      ),
    );
    expect((await rows(u)).map((r) => r.skillId)).toEqual(roles);
    const r = await ranks(u);
    expect(isExactly(r, A) || isExactly(r, B)).toBe(true);
    expect(await db.select().from(quizAnswers)).toHaveLength(2);
  });

  it('serializes saveOnboarding with focus racing setFocus', async () => {
    await saveOnboarding(db, { ...base(), focus: ['s6'] });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        i % 2 === 0 ? saveOnboarding(db, { ...base(), focus: A }) : setFocus(db, u, B, roles),
      ),
    );
    const r = await ranks(u);
    expect(isExactly(r, A) || isExactly(r, B)).toBe(true);
  });

  it('gives up with FocusBusyError when the lock is held too long, writing nothing', async () => {
    await saveOnboarding(db, { ...base(), focus: ['s1'] });
    let release!: () => void;
    let locked!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${FOCUS_LOCK_NAMESPACE}, hashtext(${u}))`);
      locked();
      await held;
    });
    await isLocked;
    const started = Date.now();
    try {
      await expect(setFocus(db, u, ['s2'], roles)).rejects.toBeInstanceOf(FocusBusyError);
      await expect(saveOnboarding(db, { ...base(), focus: ['s3'] })).rejects.toBeInstanceOf(FocusBusyError);
    } finally {
      release();
      await holder;
    }
    expect(Date.now() - started).toBeGreaterThanOrEqual(9_000); // two waits of lock_timeout = 5s
    expect(await ranks(u)).toEqual({ s1: 1 });
    await setFocus(db, u, ['s2'], roles); // a free lock is taken right away
    expect(await ranks(u)).toEqual({ s2: 1 });
  }, 20_000);
});

describe('lock timeout scope', () => {
  it('applies lock_timeout only while taking the lock', async () => {
    const seen = await db.transaction(async (tx) => {
      await lockUser(tx, u);
      const r = await tx.execute(sql`select current_setting('lock_timeout') as v`);
      return (r as unknown as { rows?: { v: string }[] }).rows?.[0]?.v ?? (r as unknown as { v: string }[])[0]?.v;
    });
    expect(seen).toBe('0');
  });
});

describe('isolation', () => {
  it("never touches another user's rows", async () => {
    const other = await newUser();
    await saveOnboarding(db, { ...base(), userId: other, focus: ['s2', 's1'] });
    await saveOnboarding(db, { ...base(), focus: ['s1'] });
    const before = await rows(other);
    await setFocus(db, u, ['s3', 's1'], roles);
    await saveOnboarding(db, { ...base(), focus: ['s2'], results: [{ skillId: 's2', level: 3, uncertain: false }] });
    expect(await rows(other)).toEqual(before);
  });
});
