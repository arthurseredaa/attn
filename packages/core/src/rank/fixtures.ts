import type { ArticleType, EventKind, LabelStatus, Source } from '@attn/shared';
import { articleEvents, articleSkills, articles, userSkills, users } from '../db/schema';
import type { Db } from '../db/client';
import type { RankConfig } from './types';

export const rankConfig: RankConfig = {
  quality_min: 2,
  background_quality_min: 4,
  fresh_days: 14,
  background_priority: 0.1,
  fit_next: 1.0,
  fit_same: 0.8,
  fit_stretch: 0.5,
};

export const RANK_NOW = new Date('2026-10-14T12:00:00.000Z');

export const rankSources: Source[] = [{ id: 'src', name: 'Source One', type: 'rss', url: 'https://src.test/feed.xml' }];

let counter = 0;

export async function makeUser(db: Db): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ githubId: 1_000_000 + ++counter, login: `rank-user-${counter}` })
    .returning({ id: users.id });
  return row!.id;
}

export async function giveSkill(
  db: Db,
  userId: string,
  skillId: string,
  over: Partial<typeof userSkills.$inferInsert> = {},
): Promise<void> {
  await db.insert(userSkills).values({
    userId,
    skillId,
    level: 2,
    uncertain: false,
    interest: 1,
    difficultyOffset: 0,
    focusRank: null,
    ...over,
  });
}

export interface ArticleFixture {
  primary: string;
  secondary?: string[];
  difficulty?: number;
  quality?: number;
  type?: ArticleType;
  publishedAt?: Date;
  status?: LabelStatus;
  url?: string;
  sourceId?: string;
  title?: string;
}

export async function makeArticle(db: Db, o: ArticleFixture): Promise<number> {
  const n = ++counter;
  const status = o.status ?? 'labeled';
  const labeled = status === 'labeled';
  const [row] = await db
    .insert(articles)
    .values({
      sourceId: o.sourceId ?? 'src',
      url: o.url ?? `https://src.test/a/${n}`,
      guid: `guid-${n}`,
      title: o.title ?? `Article ${n}`,
      titleHash: `hash-${n}`,
      publishedAt: o.publishedAt ?? new Date(RANK_NOW.getTime() - 86_400_000),
      wordCount: 1000,
      labelStatus: status,
      difficulty: labeled ? (o.difficulty ?? 2) : null,
      type: labeled ? (o.type ?? 'tutorial') : null,
      quality: labeled ? (o.quality ?? 3) : null,
      labelModel: 'test',
    })
    .returning({ id: articles.id });
  const id = row!.id;
  await db.insert(articleSkills).values([
    { articleId: id, skillId: o.primary, isPrimary: true },
    ...(o.secondary ?? []).map((skillId) => ({ articleId: id, skillId, isPrimary: false })),
  ]);
  return id;
}

export async function addEvent(db: Db, userId: string, articleId: number, kind: EventKind): Promise<void> {
  await db.insert(articleEvents).values({ userId, articleId, kind });
}
