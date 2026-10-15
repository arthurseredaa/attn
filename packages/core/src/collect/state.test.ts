import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client';
import { sourceState } from '../db/schema';
import { resetDb, testDb } from '../test/db';
import { getState, recordFailure, recordSuccess } from './state';

let db: Db;
beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});

const t1 = new Date('2026-10-01T00:00:00Z');
const t2 = new Date('2026-10-02T00:00:00Z');

async function row(id: string) {
  const [r] = await db.select().from(sourceState).where(eq(sourceState.sourceId, id));
  return r!;
}

describe('source_state', () => {
  it('getState returns null for an unknown source', async () => {
    expect(await getState(db, 'x')).toBeNull();
  });

  it('recordSuccess stores validators and clears nothing else wrongly', async () => {
    await recordSuccess(db, 'x', { etag: '"a"', lastModified: 'lm' }, t1);
    expect(await getState(db, 'x')).toEqual({ etag: '"a"', lastModified: 'lm' });
    expect((await row('x')).lastRunAt).toEqual(t1);
  });

  it('recordFailure keeps validators and sets last_error; later success clears it', async () => {
    await recordSuccess(db, 'x', { etag: '"a"', lastModified: 'lm' }, t1);
    await recordFailure(db, 'x', 'boom', t2);
    expect(await getState(db, 'x')).toEqual({ etag: '"a"', lastModified: 'lm' });
    const failed = await row('x');
    expect(failed.lastError).toBe('boom');
    expect(failed.lastRunAt).toEqual(t2);
    await recordSuccess(db, 'x', { etag: '"b"', lastModified: null }, t2);
    expect((await row('x')).lastError).toBeNull();
    expect(await getState(db, 'x')).toEqual({ etag: '"b"', lastModified: null });
  });

  it('recordFailure on an unknown source creates a row with null validators', async () => {
    await recordFailure(db, 'y', 'nope', t1);
    expect(await getState(db, 'y')).toEqual({ etag: null, lastModified: null });
  });
});

describe('validators and a changed feed url', () => {
  it('returns the stored validators for the same url and none for another one', async () => {
    await recordSuccess(db, 'x', { etag: '"a"', lastModified: 'lm' }, t1, 'https://e.test/old');
    expect(await getState(db, 'x', 'https://e.test/old')).toEqual({ etag: '"a"', lastModified: 'lm' });
    expect(await getState(db, 'x', 'https://e.test/new')).toEqual({ etag: null, lastModified: null });
  });

  it('ignores validators stored before feed_url existed (null url)', async () => {
    await recordSuccess(db, 'x', { etag: '"a"', lastModified: 'lm' }, t1);
    expect(await getState(db, 'x', 'https://e.test/new')).toEqual({ etag: null, lastModified: null });
  });
});
