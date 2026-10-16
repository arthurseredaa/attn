import { sql } from 'drizzle-orm';
import { afterAll } from 'vitest';
import { createDb, type Db } from '../db/client';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://attn:attn@localhost:5432/attn_test';

let shared: { db: Db; close(): Promise<void> } | undefined;

/** One connection pool per test file, closed after the file's tests finish. */
export async function testDb(): Promise<Db> {
  if (!shared) {
    shared = createDb(TEST_DATABASE_URL);
    afterAll(async () => {
      await shared?.close();
      shared = undefined;
    });
  }
  return shared.db;
}

export async function resetDb(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE users, sessions, source_state, articles, article_skills, user_skills, quiz_answers, article_events RESTART IDENTITY CASCADE`,
  );
}
