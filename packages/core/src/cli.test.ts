import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { articles } from './db/schema';
import type { Db } from './db/client';
import { readFixture } from './collect/fixtures/load';
import { startServer, type TestServer } from './test/server';
import { resetDb, TEST_DATABASE_URL, testDb } from './test/db';
import { run } from './cli';

const deps = { now: new Date('2026-10-14T12:00:00Z') };

let db: Db;
let server: TestServer;
let tmp: string;
let env: NodeJS.ProcessEnv;
let out: string[];
let err: string[];
const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };

beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
  server = await startServer();
  server.setRoute('/rss.xml', {
    headers: { 'Content-Type': 'application/xml' },
    body: readFixture('rss.xml', server.baseUrl),
  });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'attn-cli-'));
  fs.writeFileSync(
    path.join(tmp, 'sources.yml'),
    `- id: local-feed\n  name: Local feed\n  type: rss\n  url: ${server.baseUrl}/rss.xml\n`,
  );
  fs.copyFileSync(path.resolve(import.meta.dirname, '../../../data/config.yml'), path.join(tmp, 'config.yml'));
  env = { DATABASE_URL: TEST_DATABASE_URL, ATTN_DATA_DIR: tmp };
  out = [];
  err = [];
});
afterEach(async () => {
  await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('attn collect', () => {
  it('collects and prints a line per source plus totals', async () => {
    expect(await run(['collect'], env, io, deps)).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('local-feed');
    expect(text).toContain('inserted=4');
    expect(text).toContain('total:');
    expect(await db.select().from(articles)).toHaveLength(4);
  });

  it('rejects an unknown --source', async () => {
    expect(await run(['collect', '--source', 'nope'], env, io, deps)).toBe(1);
    expect(err.join('\n')).toContain('nope');
  });

  it('fails without DATABASE_URL', async () => {
    expect(await run(['collect'], { ATTN_DATA_DIR: tmp }, io, deps)).toBe(1);
    expect(err.join('\n')).toContain('DATABASE_URL');
  });

  it('honors --backfill-days', async () => {
    expect(await run(['collect', '--backfill-days', '10'], env, io, deps)).toBe(0);
    expect(out.join('\n')).toContain('inserted=3');
    expect((await db.select().from(articles)).map((a) => a.title).sort()).toEqual(['First post', 'Future', 'Undated']);
  });

  it.each(['0', 'abc'])('rejects --backfill-days %s', async (v) => {
    expect(await run(['collect', '--backfill-days', v], env, io, deps)).toBe(1);
    expect(err.join('\n')).toContain('--backfill-days');
  });
});

describe('attn migrate', () => {
  it('is idempotent', async () => {
    expect(await run(['migrate'], env, io)).toBe(0);
    expect(await run(['migrate'], env, io)).toBe(0);
  });
});

it('unknown command prints usage', async () => {
  expect(await run(['frobnicate'], env, io)).toBe(1);
  expect(err.join('\n')).toContain('migrate | collect');
});
