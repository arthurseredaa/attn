import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../test/db';
import { withAdvisoryLock } from './lock';

const KEY = 727901;

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('withAdvisoryLock', () => {
  it('acquires, runs fn once and returns its value', async () => {
    let calls = 0;
    const r = await withAdvisoryLock(TEST_DATABASE_URL, KEY, async () => ++calls && 'v');
    expect(r).toEqual({ acquired: true, value: 'v' });
    expect(calls).toBe(1);
  });

  it('does not acquire a held key and does not run fn; acquires after release', async () => {
    const g = gate();
    const entered = gate();
    const first = withAdvisoryLock(TEST_DATABASE_URL, KEY, async () => {
      entered.open();
      await g.promise;
      return 1;
    });
    await entered.promise;
    let ran = false;
    const second = await withAdvisoryLock(TEST_DATABASE_URL, KEY, async () => {
      ran = true;
    });
    expect(second).toEqual({ acquired: false });
    expect(ran).toBe(false);
    g.open();
    expect(await first).toEqual({ acquired: true, value: 1 });
    expect(await withAdvisoryLock(TEST_DATABASE_URL, KEY, async () => 3)).toEqual({ acquired: true, value: 3 });
  });

  it('propagates fn errors and releases the lock', async () => {
    await expect(
      withAdvisoryLock(TEST_DATABASE_URL, KEY, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await withAdvisoryLock(TEST_DATABASE_URL, KEY, async () => 'ok')).toEqual({ acquired: true, value: 'ok' });
  });

  it('different keys do not block each other', async () => {
    const g = gate();
    const entered = gate();
    const first = withAdvisoryLock(TEST_DATABASE_URL, KEY, async () => {
      entered.open();
      await g.promise;
    });
    await entered.promise;
    expect(await withAdvisoryLock(TEST_DATABASE_URL, KEY + 1, async () => 'other')).toEqual({
      acquired: true,
      value: 'other',
    });
    g.open();
    await first;
  });

  it('two sequential calls both acquire', async () => {
    expect(await withAdvisoryLock(TEST_DATABASE_URL, KEY, async () => 1)).toEqual({ acquired: true, value: 1 });
    expect(await withAdvisoryLock(TEST_DATABASE_URL, KEY, async () => 2)).toEqual({ acquired: true, value: 2 });
  });

  it('leaves no advisory lock behind', async () => {
    await withAdvisoryLock(TEST_DATABASE_URL, KEY, async () => 1);
    const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      const [row] = await sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and objid = ${KEY}`;
      expect(row!.n).toBe(0);
    } finally {
      await sql.end();
    }
  });
});
