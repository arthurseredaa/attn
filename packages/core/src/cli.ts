import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig, loadSources, dataDir } from './data';
import { createDb, runMigrations } from './db';
import { collectAll, type SourceReport } from './collect/collect';
import type { FetchFn } from './collect/http';

export interface Io {
  out(s: string): void;
  err(s: string): void;
}

export interface Deps {
  now?: Date;
  fetchFn?: FetchFn;
}

const USAGE = `usage: attn <migrate | collect>

commands:
  migrate                                              apply database migrations
  collect [--source <id>]... [--backfill-days <n>]    collect new articles from sources
`;

const defaultIo: Io = {
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
};

function formatReport(r: SourceReport): string {
  const line = `${r.sourceId}  ${r.status}  seen=${r.seen} inserted=${r.inserted} dup=${r.duplicates} old=${r.tooOld} skipped=${r.skipped}`;
  return r.error ? `${line}  ${r.error}` : line;
}

async function collect(args: string[], env: NodeJS.ProcessEnv, io: Io, deps: Deps): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      source: { type: 'string', multiple: true },
      'backfill-days': { type: 'string' },
    },
    strict: true,
  });

  let backfillDays: number | undefined;
  const rawDays = values['backfill-days'];
  if (rawDays !== undefined) {
    if (!/^\d+$/.test(rawDays) || Number(rawDays) < 1) {
      io.err(`--backfill-days must be a positive integer, got "${rawDays}"`);
      return 1;
    }
    backfillDays = Number(rawDays);
  }

  const url = env.DATABASE_URL;
  if (!url) {
    io.err('DATABASE_URL is not set');
    return 1;
  }

  const dir = env.ATTN_DATA_DIR ?? dataDir();
  const sources = loadSources(dir);
  const config = loadConfig(dir);

  const { db, close } = createDb(url);
  try {
    const reports = await collectAll({
      db,
      sources,
      config,
      ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
      ...(deps.now ? { now: deps.now } : {}),
      ...(backfillDays !== undefined ? { backfillDays } : {}),
      ...(values.source ? { onlySourceIds: values.source } : {}),
    });
    for (const r of reports) io.out(formatReport(r));
    const sum = (k: 'inserted' | 'duplicates') => reports.reduce((n, r) => n + r[k], 0);
    const failed = reports.filter((r) => r.status === 'error').length;
    io.out(`total: sources=${reports.length} inserted=${sum('inserted')} dup=${sum('duplicates')} errors=${failed}`);
    return 0;
  } finally {
    await close();
  }
}

export async function run(argv: string[], env: NodeJS.ProcessEnv, io: Io = defaultIo, deps: Deps = {}): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'migrate': {
        if (!env.DATABASE_URL) {
          io.err('DATABASE_URL is not set');
          return 1;
        }
        await runMigrations(env.DATABASE_URL);
        io.out('migrations applied');
        return 0;
      }
      case 'collect':
        return await collect(rest, env, io, deps);
      default:
        io.err(command ? `unknown command: ${command}\n${USAGE}` : USAGE);
        return 1;
    }
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  process.exitCode = await run(process.argv.slice(2), process.env);
}
