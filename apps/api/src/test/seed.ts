import { articleSkills, articles, loadTaxonomy, users, type Db } from '@attn/core';
import { taxonomySkillIds, type ArticleType, type LabelStatus } from '@attn/shared';

let counter = 0;

export function skillIds(n: number): string[] {
  const ids = taxonomySkillIds(loadTaxonomy());
  if (ids.length < n) throw new Error(`taxonomy has fewer than ${n} skills`);
  return ids.slice(0, n);
}

export async function seedUser(db: Db, over: Partial<typeof users.$inferInsert> = {}) {
  counter += 1;
  const [row] = await db
    .insert(users)
    .values({ githubId: 1000 + counter, login: `user${counter}`, name: `User ${counter}`, avatarUrl: null, ...over })
    .returning();
  if (!row) throw new Error('seedUser failed');
  return row;
}

export interface SeedArticle {
  sourceId?: string;
  title?: string;
  url?: string;
  publishedAt?: Date;
  status?: LabelStatus;
  primary?: string;
  secondary?: string[];
  wordCount?: number | null;
  difficulty?: number;
  type?: ArticleType;
  quality?: number;
}

/** Inserts a labeled article (status override allowed) with its skills; returns the article id. */
export async function seedArticle(db: Db, o: SeedArticle = {}): Promise<number> {
  counter += 1;
  const url = o.url ?? `https://example.com/a/${counter}`;
  const title = o.title ?? `Article ${counter}`;
  const labeled = (o.status ?? 'labeled') === 'labeled';
  const [row] = await db
    .insert(articles)
    .values({
      sourceId: o.sourceId ?? 'src',
      url,
      guid: url,
      title,
      titleHash: `hash-${counter}`,
      publishedAt: o.publishedAt ?? new Date('2026-03-01T00:00:00.000Z'),
      wordCount: o.wordCount === undefined ? 800 : o.wordCount,
      labelStatus: o.status ?? 'labeled',
      difficulty: labeled ? (o.difficulty ?? 2) : null,
      type: labeled ? (o.type ?? 'tutorial') : null,
      quality: labeled ? (o.quality ?? 3) : null,
    })
    .returning({ id: articles.id });
  if (!row) throw new Error('seedArticle failed');
  if (labeled) {
    const primary = o.primary ?? 'orphan-skill';
    await db.insert(articleSkills).values([
      { articleId: row.id, skillId: primary, isPrimary: true },
      ...(o.secondary ?? []).map((s) => ({ articleId: row.id, skillId: s, isPrimary: false })),
    ]);
  }
  return row.id;
}
