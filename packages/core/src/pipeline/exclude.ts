import { and, asc, eq, lte, sql, type SQL } from 'drizzle-orm';
import { articles, type Db } from '../db';

export interface ExcludeOptions {
  db: Db;
  /** Select labeled articles with quality <= this. */
  maxQuality?: number;
  /** Select articles in this status (only `failed` makes sense: pending ones are about to be labeled). */
  status?: 'failed';
  reason: string;
  dryRun?: boolean;
  now?: Date;
  /** How many sample rows to return (default 10). */
  sampleSize?: number;
}

export interface ExcludeReport {
  /** Articles matched (dry run) or excluded. */
  count: number;
  samples: { id: number; sourceId: string; title: string; quality: number | null }[];
}

/** Marks articles `excluded` (they stay in the table, so collect's url dedup keeps them out). Exactly one selector. */
export async function excludeArticles(opts: ExcludeOptions): Promise<ExcludeReport> {
  const { db } = opts;
  if ((opts.maxQuality === undefined) === (opts.status === undefined)) {
    throw new Error('give exactly one of maxQuality or status');
  }
  const where: SQL =
    opts.maxQuality !== undefined
      ? (and(eq(articles.labelStatus, 'labeled'), lte(articles.quality, opts.maxQuality)) as SQL)
      : eq(articles.labelStatus, 'failed');
  const samples = await db
    .select({ id: articles.id, sourceId: articles.sourceId, title: articles.title, quality: articles.quality })
    .from(articles)
    .where(where)
    .orderBy(asc(articles.id))
    .limit(opts.sampleSize ?? 10);
  if (opts.dryRun) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(articles)
      .where(where);
    return { count: row?.n ?? 0, samples };
  }
  const updated = await db
    .update(articles)
    .set({ labelStatus: 'excluded', excludedReason: opts.reason, excludedAt: opts.now ?? new Date() })
    .where(where)
    .returning({ id: articles.id });
  return { count: updated.length, samples };
}

/** Returns an excluded article to `pending` (attempts reset, relevance gate bypassed from now on) so the next label run handles it. False if it is not excluded. */
export async function unexcludeArticle(db: Db, id: number): Promise<boolean> {
  const updated = await db
    .update(articles)
    .set({ labelStatus: 'pending', labelAttempts: 0, excludedReason: null, excludedAt: null, relevanceOverride: true })
    .where(and(eq(articles.id, id), eq(articles.labelStatus, 'excluded')))
    .returning({ id: articles.id });
  return updated.length > 0;
}
