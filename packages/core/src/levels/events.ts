import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Config, EventKind } from '@attn/shared';
import { articleEvents, articleSkills, articles, quizAnswers, userSkills, type Db } from '../db';
import { applyNotInterested, computeDifficultyOffset } from './feedback';
import { applyReadPoint } from './points';

export type FeedbackConfig = Pick<Config, 'points_per_level' | 'offset_k' | 'interest_decay' | 'interest_min'>;

/** The article does not exist, is not labeled, or has no primary skill. */
export class ArticleNotFoundError extends Error {
  constructor(readonly articleId: number) {
    super(`Article ${articleId} not found`);
    this.name = 'ArticleNotFoundError';
  }
}

export interface RecordEventResult {
  recorded: boolean;
  skillUpdated: boolean;
}

/** Same rule as `skillIdOfQuestionId` (@attn/shared): `<skill_id>-<n>`, greedy, no match = no skill. */
const QUESTION_ID_PATTERN = '^(.+)-[0-9]+$';

export async function recordEvent(
  db: Db,
  input: { userId: string; articleId: number; kind: EventKind },
  cfg: FeedbackConfig,
): Promise<RecordEventResult> {
  const { userId, articleId, kind } = input;
  return db.transaction(async (tx) => {
    const [art] = await tx
      .select({ difficulty: articles.difficulty, skillId: articleSkills.skillId })
      .from(articles)
      .innerJoin(articleSkills, and(eq(articleSkills.articleId, articles.id), eq(articleSkills.isPrimary, true)))
      .where(and(eq(articles.id, articleId), eq(articles.labelStatus, 'labeled')));
    if (!art || art.difficulty === null) throw new ArticleNotFoundError(articleId);

    // 1. Lock the (user, skill) row first: every effect for it is serialized, and the lock order
    //    (user_skills, then article_events) is the same for every caller. No row = not onboarded.
    const where = and(eq(userSkills.userId, userId), eq(userSkills.skillId, art.skillId));
    const [row] = await tx.select().from(userSkills).where(where).for('update');

    // 2. The unique event is the gate: a repeat inserts nothing and applies nothing.
    const inserted = await tx
      .insert(articleEvents)
      .values({ userId, articleId, kind })
      .onConflictDoNothing({ target: [articleEvents.userId, articleEvents.articleId, articleEvents.kind] })
      .returning({ id: articleEvents.id });
    if (inserted.length === 0) return { recorded: false, skillUpdated: false };
    if (!row || kind === 'like') return { recorded: true, skillUpdated: false };

    if (kind === 'read') {
      const next = applyReadPoint({ level: row.level, points: row.points }, art.difficulty, cfg.points_per_level);
      if (!next.awarded) return { recorded: true, skillUpdated: false };
      await tx.update(userSkills).set({ level: next.level, points: next.points }).where(where);
    } else if (kind === 'not_interested') {
      const interest = applyNotInterested(row.interest, cfg.interest_decay, cfg.interest_min);
      await tx.update(userSkills).set({ interest }).where(where);
    } else {
      // too_easy | too_hard: recompute from this user's events on articles with this primary skill,
      // counting only events newer than the user's latest quiz answer for the skill (Decision 14).
      // The marker stays inside SQL (the raw timestamptz never round-trips through the driver);
      // no answers for the skill -> max() is null -> coalesce lets every event count.
      const marker = sql`(select max(${quizAnswers.answeredAt}) from ${quizAnswers}
        where ${quizAnswers.userId} = ${userId}
          and substring(${quizAnswers.questionId} from ${QUESTION_ID_PATTERN}::text) = ${art.skillId})`;
      const counts = await tx
        .select({ kind: articleEvents.kind, n: sql<number>`count(*)::int` })
        .from(articleEvents)
        .innerJoin(
          articleSkills,
          and(eq(articleSkills.articleId, articleEvents.articleId), eq(articleSkills.isPrimary, true)),
        )
        .where(
          and(
            eq(articleEvents.userId, userId),
            eq(articleSkills.skillId, art.skillId),
            inArray(articleEvents.kind, ['too_easy', 'too_hard']),
            sql`${articleEvents.createdAt} > coalesce(${marker}, '-infinity'::timestamptz)`,
          ),
        )
        .groupBy(articleEvents.kind);
      const n = (k: EventKind) => counts.find((c) => c.kind === k)?.n ?? 0;
      const difficultyOffset = computeDifficultyOffset(n('too_easy'), n('too_hard'), cfg.offset_k);
      await tx.update(userSkills).set({ difficultyOffset }).where(where);
    }
    return { recorded: true, skillUpdated: true };
  });
}
