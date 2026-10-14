import postgres from "postgres";

export type LockResult<T> = { acquired: false } | { acquired: true; value: T };

/**
 * Runs `fn` while holding a session-level Postgres advisory lock, or returns `{ acquired: false }`
 * without running it when another session holds the key. The lock lives on a dedicated
 * single-connection client (a session lock must be released on the connection that took it);
 * closing that connection in `finally` also releases the lock if the explicit unlock fails.
 */
export async function withAdvisoryLock<T>(
  url: string,
  key: number,
  fn: () => Promise<T>,
): Promise<LockResult<T>> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql<
      { locked: boolean }[]
    >`select pg_try_advisory_lock(${key}::bigint) as locked`;
    if (!row?.locked) return { acquired: false };
    try {
      return { acquired: true, value: await fn() };
    } finally {
      await sql`select pg_advisory_unlock(${key}::bigint)`.catch(
        () => undefined,
      );
    }
  } finally {
    await sql.end();
  }
}
