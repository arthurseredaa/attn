import { and, eq, gte, lt, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import { articles } from '../db/schema';
import { utcDayBounds } from './normalize';

export interface Candidate {
  sourceId: string;
  /** normalized */
  url: string;
  guid: string;
  title: string;
  titleHash: string;
  publishedAt: Date;
}

export async function urlExists(db: Db, url: string): Promise<boolean> {
  const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.url, url)).limit(1);
  return rows.length > 0;
}

/** Same url, OR same guid (any source), OR same title_hash published on the same UTC day. */
export async function isDuplicate(db: Db, c: Candidate): Promise<boolean> {
  const { start, end } = utcDayBounds(c.publishedAt);
  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .where(
      or(
        eq(articles.url, c.url),
        eq(articles.guid, c.guid),
        and(
          eq(articles.titleHash, c.titleHash),
          gte(articles.publishedAt, start),
          lt(articles.publishedAt, end),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
