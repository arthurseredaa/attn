import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sourceState } from '../db/schema';
import type { CachedState } from './http';

/** null when the source has no source_state row at all (i.e. it has never run). */
export async function getState(db: Db, sourceId: string): Promise<CachedState | null> {
  const [row] = await db.select().from(sourceState).where(eq(sourceState.sourceId, sourceId));
  return row ? { etag: row.etag, lastModified: row.lastModified } : null;
}

export async function recordSuccess(
  db: Db,
  sourceId: string,
  v: CachedState,
  now: Date,
): Promise<void> {
  const values = { etag: v.etag, lastModified: v.lastModified, lastRunAt: now, lastError: null };
  await db
    .insert(sourceState)
    .values({ sourceId, ...values })
    .onConflictDoUpdate({ target: sourceState.sourceId, set: values });
}

export async function recordFailure(
  db: Db,
  sourceId: string,
  message: string,
  now: Date,
): Promise<void> {
  await db
    .insert(sourceState)
    .values({ sourceId, lastError: message, lastRunAt: now })
    .onConflictDoUpdate({
      target: sourceState.sourceId,
      set: { lastError: message, lastRunAt: now },
    });
}
