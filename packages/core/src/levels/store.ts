import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { quizAnswers, userSkills, type Db } from '../db';
import { assertValidFocus, FocusError } from './role';
import type { QuizAnswer, SkillQuizResult } from './quiz';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const FOCUS_LOCK_NAMESPACE = 727002; // PIPELINE_LOCK_KEY is 727001 (db/lock.ts); the two-int form keeps keyspaces apart
/** How long a focus write waits for the per-user lock; a waiter holds a pool connection meanwhile. */
export const FOCUS_LOCK_TIMEOUT = '5s';

export class NotOnboardedError extends Error {
  constructor() {
    super('User has not completed onboarding');
    this.name = 'NotOnboardedError';
  }
}

/** Another focus or onboarding write of the same user held the lock longer than FOCUS_LOCK_TIMEOUT. */
export class FocusBusyError extends Error {
  constructor() {
    super('Another change to your skills is still being saved; try again in a moment');
    this.name = 'FocusBusyError';
  }
}

const LOCK_NOT_AVAILABLE = '55P03';

function sqlState(e: unknown): string | undefined {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = err?.cause?.code ?? err?.code;
  return typeof code === 'string' ? code : undefined;
}

export interface OnboardingInput {
  userId: string;
  roleSkillIds: string[];
  focus?: string[];
  results: SkillQuizResult[];
  answers: QuizAnswer[];
  quizVersion: number;
}

async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql.raw(`set local lock_timeout = '${FOCUS_LOCK_TIMEOUT}'`));
  try {
    await tx.execute(sql`select pg_advisory_xact_lock(${FOCUS_LOCK_NAMESPACE}, hashtext(${userId}))`);
  } catch (e) {
    if (sqlState(e) === LOCK_NOT_AVAILABLE) throw new FocusBusyError();
    throw e;
  }
}

/** Onboarded = the user has at least one user_skills row (plan Decision 3); the one place that rule lives. */
async function hasSkillRows(q: Db | Tx, userId: string): Promise<boolean> {
  const rows = await q.select({ one: sql<number>`1` }).from(userSkills).where(eq(userSkills.userId, userId)).limit(1);
  return rows.length > 0;
}

async function ensureRows(tx: Tx, userId: string, roleSkillIds: string[]): Promise<void> {
  if (roleSkillIds.length === 0) return;
  await tx
    .insert(userSkills)
    .values(roleSkillIds.map((skillId) => ({ userId, skillId, level: null, uncertain: true })))
    .onConflictDoNothing();
}

/** The unique index on (user_id, focus_rank) is not deferrable: null every rank first, then set the new ones. */
async function writeFocus(tx: Tx, userId: string, focus: string[]): Promise<void> {
  await tx
    .update(userSkills)
    .set({ focusRank: null })
    .where(and(eq(userSkills.userId, userId), isNotNull(userSkills.focusRank)));
  for (const [i, skillId] of focus.entries()) {
    await tx
      .update(userSkills)
      .set({ focusRank: i + 1 })
      .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)));
  }
}

export function isOnboarded(db: Db, userId: string): Promise<boolean> {
  return hasSkillRows(db, userId);
}

export async function saveOnboarding(db: Db, input: OnboardingInput): Promise<void> {
  const { userId, roleSkillIds, focus, results, answers, quizVersion } = input;
  if (focus) assertValidFocus(focus, roleSkillIds);
  const known = new Set(roleSkillIds);
  const outside = results.find((r) => !known.has(r.skillId));
  if (outside) throw new Error(`Quiz result for a skill outside the role: ${outside.skillId}`);

  await db.transaction(async (tx) => {
    await lockUser(tx, userId);
    if (!focus && !(await hasSkillRows(tx, userId))) throw new FocusError('empty', 'Pick a focus first');
    await ensureRows(tx, userId, roleSkillIds);
    if (focus) await writeFocus(tx, userId, focus);
    for (const r of results) {
      await tx
        .update(userSkills)
        .set({ level: r.level, uncertain: r.uncertain, points: 0, difficultyOffset: 0 })
        .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, r.skillId)));
    }
    if (answers.length > 0) {
      await tx
        .insert(quizAnswers)
        .values(
          answers.map((a) => ({
            userId,
            questionId: a.questionId,
            firstOption: a.first,
            secondOption: a.second,
            quizVersion,
          })),
        )
        .onConflictDoUpdate({
          target: [quizAnswers.userId, quizAnswers.questionId],
          set: {
            firstOption: sql`excluded.first_option`,
            secondOption: sql`excluded.second_option`,
            quizVersion: sql`excluded.quiz_version`,
            answeredAt: sql`now()`,
          },
        });
    }
  });
}

export async function setFocus(db: Db, userId: string, focus: string[], roleSkillIds: string[]): Promise<void> {
  assertValidFocus(focus, roleSkillIds);
  await db.transaction(async (tx) => {
    await lockUser(tx, userId);
    if (!(await hasSkillRows(tx, userId))) throw new NotOnboardedError();
    await ensureRows(tx, userId, roleSkillIds);
    await writeFocus(tx, userId, focus);
  });
}
