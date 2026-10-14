import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { quizAnswers, userSkills, type Db } from '../db';
import { assertValidFocus } from './role';
import type { QuizAnswer, SkillQuizResult } from './quiz';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const FOCUS_LOCK_NAMESPACE = 727002; // PIPELINE_LOCK_KEY is 727001 (db/lock.ts); the two-int form keeps keyspaces apart

export class NotOnboardedError extends Error {
  constructor() {
    super('User has not completed onboarding');
    this.name = 'NotOnboardedError';
  }
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
  await tx.execute(sql`select pg_advisory_xact_lock(${FOCUS_LOCK_NAMESPACE}, hashtext(${userId}))`);
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

export async function isOnboarded(db: Db, userId: string): Promise<boolean> {
  const rows = await db.select({ one: sql<number>`1` }).from(userSkills).where(eq(userSkills.userId, userId)).limit(1);
  return rows.length > 0;
}

export async function saveOnboarding(db: Db, input: OnboardingInput): Promise<void> {
  const { userId, roleSkillIds, focus, results, answers, quizVersion } = input;
  if (focus) assertValidFocus(focus, roleSkillIds);
  const known = new Set(roleSkillIds);
  const outside = results.find((r) => !known.has(r.skillId));
  if (outside) throw new Error(`Quiz result for a skill outside the role: ${outside.skillId}`);

  await db.transaction(async (tx) => {
    await lockUser(tx, userId);
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
    const existing = await tx.select({ one: sql<number>`1` }).from(userSkills).where(eq(userSkills.userId, userId)).limit(1);
    if (existing.length === 0) throw new NotOnboardedError();
    await ensureRows(tx, userId, roleSkillIds);
    await writeFocus(tx, userId, focus);
  });
}
