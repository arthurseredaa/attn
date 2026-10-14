import postgres from 'postgres';
import { runMigrations } from '../db/migrate';
import { TEST_DATABASE_URL } from './db';

export default async function setup(): Promise<void> {
  const target = new URL(TEST_DATABASE_URL);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = '/postgres';
  const client = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const rows = await client`select 1 from pg_database where datname = ${dbName}`;
    if (rows.length === 0) {
      await client.unsafe(`create database "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }
  await runMigrations(TEST_DATABASE_URL);
}
