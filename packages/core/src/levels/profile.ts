import { and, count, desc, eq, exists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  skillIdOfQuestionId,
  type Level,
  type Profile,
  type ProfileSkill,
  type Source,
  type Taxonomy,
} from '@attn/shared';
import { articleEvents, articles, quizAnswers, userSkills, type Db } from '../db';
import { progressToNext } from './points';
import { roleSkillIds } from './role';
import { effectiveLevel, effectiveUncertain } from './scale';

export const HISTORY_LIMIT = 20;

export interface ProfileContext {
  role: string;
  taxonomy: Taxonomy;
  sources: Source[];
  pointsPerLevel: number;
}

/** liked / read; null when nothing was read. */
export function likeShare(read: number, liked: number): number | null {
  return read === 0 ? null : liked / read;
}

/** Read-only: never writes, so a not-onboarded user is shown as fully unassessed. */
export async function buildProfile(db: Db, userId: string, ctx: ProfileContext): Promise<Profile> {
  const roleIds = new Set(roleSkillIds(ctx.taxonomy, ctx.role));
  const rows = await db.select().from(userSkills).where(eq(userSkills.userId, userId));
  const byId = new Map(rows.map((r) => [r.skillId, r]));

  const answered = await db
    .select({ questionId: quizAnswers.questionId })
    .from(quizAnswers)
    .where(eq(quizAnswers.userId, userId));
  const quizzedSkills = new Set(answered.map((a) => skillIdOfQuestionId(a.questionId)).filter((id) => id !== null));

  // Ranks are renumbered 1..n at read time: a focus skill that left the taxonomy leaves no gap in what the
  // user sees. The stored focus_rank keeps the gap until the next focus save (see docs/decisions.md).
  const focusRows = rows
    .filter((r): r is typeof r & { focusRank: number } => r.focusRank !== null && roleIds.has(r.skillId))
    .sort((a, b) => a.focusRank - b.focusRank);
  const rankOf = new Map(focusRows.map((r, i) => [r.skillId, i + 1]));

  const names = new Map<string, string>();
  const domains = ctx.taxonomy.domains
    .map((d) => ({
      id: d.id,
      name: d.name,
      skills: d.skills
        .filter((s) => roleIds.has(s.id))
        .map((s): ProfileSkill => {
          names.set(s.id, s.name);
          const row = byId.get(s.id);
          const level = row?.level ?? null;
          const points = row?.points ?? 0;
          return {
            id: s.id,
            name: s.name,
            description: s.description,
            level: level as Level | null,
            effectiveLevel: effectiveLevel(level),
            assessed: level !== null,
            quizzed: quizzedSkills.has(s.id),
            uncertain: effectiveUncertain(level, row?.uncertain ?? true),
            points,
            pointsNeeded: progressToNext(level, points, ctx.pointsPerLevel)?.needed ?? null,
            focusRank: rankOf.get(s.id) ?? null,
          };
        }),
    }))
    .filter((d) => d.skills.length > 0);

  const focus = focusRows.map((r, i) => ({ rank: i + 1, skillId: r.skillId, name: names.get(r.skillId)! }));

  const isRead = and(eq(articleEvents.userId, userId), eq(articleEvents.kind, 'read'));
  const items = await db
    .select({
      articleId: articles.id,
      title: articles.title,
      url: articles.url,
      sourceId: articles.sourceId,
      readAt: articleEvents.createdAt,
    })
    .from(articleEvents)
    .innerJoin(articles, eq(articles.id, articleEvents.articleId))
    .where(isRead)
    .orderBy(desc(articleEvents.createdAt), desc(articleEvents.id))
    .limit(HISTORY_LIMIT);
  const [{ read }] = (await db.select({ read: count() }).from(articleEvents).where(isRead)) as [{ read: number }];

  const likes = alias(articleEvents, 'liked');
  const readByUser = db
    .select({ one: sql`1` })
    .from(articleEvents)
    .where(
      and(
        eq(articleEvents.userId, userId),
        eq(articleEvents.kind, 'read'),
        eq(articleEvents.articleId, likes.articleId),
      ),
    );
  const [{ liked }] = (await db
    .select({ liked: count() })
    .from(likes)
    .where(and(eq(likes.userId, userId), eq(likes.kind, 'like'), exists(readByUser)))) as [{ liked: number }];

  const sourceNames = new Map(ctx.sources.map((s) => [s.id, s.name]));
  return {
    onboarded: rows.length > 0,
    role: ctx.role,
    focus,
    domains,
    history: {
      items: items.map((i) => ({
        articleId: i.articleId,
        title: i.title,
        url: i.url,
        sourceName: sourceNames.get(i.sourceId) ?? i.sourceId,
        readAt: i.readAt.toISOString(),
      })),
      total: read,
    },
    likes: { read, liked, share: likeShare(read, liked) },
  };
}
