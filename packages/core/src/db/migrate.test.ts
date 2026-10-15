import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';
import { TEST_DATABASE_URL } from '../test/db';

describe('migrations on a fresh database', () => {
  it('apply cleanly and add the excluded status and its columns', async () => {
    const name = `attn_migrate_${process.pid}_${Date.now()}`;
    const admin = new URL(TEST_DATABASE_URL);
    admin.pathname = '/postgres';
    const fresh = new URL(TEST_DATABASE_URL);
    fresh.pathname = `/${name}`;
    const adminSql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
    try {
      await adminSql.unsafe(`create database "${name}"`);
      await runMigrations(fresh.toString());
      await runMigrations(fresh.toString()); // idempotent
      const sql = postgres(fresh.toString(), { max: 1, onnotice: () => {} });
      try {
        const labels = await sql`select unnest(enum_range(null::label_status))::text as v`;
        expect(labels.map((r) => r.v)).toEqual(['pending', 'labeled', 'failed', 'excluded']);
        const cols = await sql`select column_name, data_type, is_nullable from information_schema.columns
          where table_name = 'articles' and column_name in ('excluded_reason', 'excluded_at') order by column_name`;
        expect(cols.map((r) => [r.column_name, r.data_type, r.is_nullable])).toEqual([
          ['excluded_at', 'timestamp with time zone', 'YES'],
          ['excluded_reason', 'text', 'YES'],
        ]);
        await sql`insert into articles (source_id, url, guid, title, title_hash, published_at, label_status)
          values ('s', 'https://e.test/x', 'g', 't', 'h', now(), 'excluded')`;
      } finally {
        await sql.end();
      }
    } finally {
      await adminSql.unsafe(`drop database if exists "${name}" with (force)`);
      await adminSql.end();
    }
  });
});
