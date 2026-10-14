import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Taxonomy } from '@attn/shared';
import { loadConfig, loadSources, loadTaxonomy, dataDir } from './data';
import { createDb, runMigrations } from './db';
import { collectAll, type SourceReport } from './collect/collect';
import type { FetchFn } from './collect/http';
import { createGeminiLabeler, type Labeler } from './label';
import { createTextCache, defaultCacheDir, formatEvalReport, loadGolden, runEval } from './eval';
import { labelPending, type LabelItemReport } from './pipeline';

export interface Io {
  out(s: string): void;
  err(s: string): void;
}

export interface Deps {
  now?: Date;
  fetchFn?: FetchFn;
  makeLabeler?: (model: string, taxonomy: Taxonomy) => Labeler;
  sleep?: (ms: number) => Promise<void>;
}

const USAGE = `usage: attn <migrate | collect | label | eval>

commands:
  migrate                                              apply database migrations
  collect [--source <id>]... [--backfill-days <n>]    collect new articles from sources
  label [--limit <n>]                                  label pending articles with the configured model
  eval --model <id>                                    measure a model against data/golden/*.yml
`;

const defaultIo: Io = {
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
};

function formatReport(r: SourceReport): string {
  const line = `${r.sourceId}  ${r.status}  seen=${r.seen} inserted=${r.inserted} dup=${r.duplicates} old=${r.tooOld} skipped=${r.skipped}`;
  return r.error ? `${line}  ${r.error}` : line;
}

export function resolveLabelerFactory(
  env: NodeJS.ProcessEnv,
  deps: Deps,
): ((model: string, taxonomy: Taxonomy) => Labeler) | { error: string } {
  if (deps.makeLabeler) return deps.makeLabeler;
  const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return { error: 'GOOGLE_GENERATIVE_AI_API_KEY is not set' };
  return (model, taxonomy) => createGeminiLabeler({ model, taxonomy, apiKey });
}

function formatLabelItem(i: LabelItemReport): string {
  const line = `${i.outcome}  ${i.url}`;
  return i.error ? `${line}  ${i.error}` : line;
}

async function labelCommand(args: string[], env: NodeJS.ProcessEnv, io: Io, deps: Deps): Promise<number> {
  const { values } = parseArgs({ args, options: { limit: { type: 'string' } }, strict: true });

  let limit: number | undefined;
  const rawLimit = values.limit;
  if (rawLimit !== undefined) {
    if (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(Number(rawLimit)) || Number(rawLimit) < 1) {
      io.err(`--limit must be a positive integer, got "${rawLimit}"`);
      return 1;
    }
    limit = Number(rawLimit);
  }

  const url = env.DATABASE_URL;
  if (!url) {
    io.err('DATABASE_URL is not set');
    return 1;
  }
  const model = env.LABEL_MODEL;
  if (!model) {
    io.err('LABEL_MODEL is not set');
    return 1;
  }
  const factory = resolveLabelerFactory(env, deps);
  if ('error' in factory) {
    io.err(factory.error);
    return 1;
  }

  const dir = env.ATTN_DATA_DIR ?? dataDir();
  const config = loadConfig(dir);
  const taxonomy = loadTaxonomy(dir);
  const labeler = factory(model, taxonomy);

  const { db, close } = createDb(url);
  try {
    const report = await labelPending({
      db,
      labeler,
      config,
      taxonomyVersion: taxonomy.version,
      ...(limit !== undefined ? { limit } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });
    for (const i of report.items) io.out(formatLabelItem(i));
    io.out(
      `total: selected=${report.selected} labeled=${report.labeled} failed=${report.failed} rate_limited=${report.rateLimited ? 'yes' : 'no'}`,
    );
    if (report.rateLimited) io.out('rate limited by the provider; the remaining articles stay pending for the next run');
    return 0;
  } finally {
    await close();
  }
}

async function evalCommand(args: string[], env: NodeJS.ProcessEnv, io: Io, deps: Deps): Promise<number> {
  const { values } = parseArgs({ args, options: { model: { type: 'string', multiple: true } }, strict: true });
  if ((values.model?.length ?? 0) > 1) {
    io.err('--model may be given only once');
    return 1;
  }
  const model = values.model?.[0];
  if (!model) {
    io.err('--model <id> is required');
    return 1;
  }

  const dir = env.ATTN_DATA_DIR ?? dataDir();
  const taxonomy = loadTaxonomy(dir);
  const golden = loadGolden(dir, taxonomy);
  if (golden.length === 0) {
    io.err(`no golden items found in ${dir}/golden; see README "Evaluation"`);
    return 1;
  }
  const factory = resolveLabelerFactory(env, deps);
  if ('error' in factory) {
    io.err(factory.error);
    return 1;
  }

  const report = await runEval({
    labeler: factory(model, taxonomy),
    golden,
    cache: createTextCache(defaultCacheDir(env)),
    config: loadConfig(dir),
    ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });
  io.out(formatEvalReport(report));
  if (report.rateLimited) {
    io.err('rate limited by the provider; evaluation is incomplete');
    return 1;
  }
  return 0;
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
    if (!/^\d+$/.test(rawDays) || !Number.isSafeInteger(Number(rawDays)) || Number(rawDays) < 1 || Number(rawDays) > 3650) {
      io.err(`--backfill-days must be an integer from 1 to 3650, got "${rawDays}"`);
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
      case 'label':
        return await labelCommand(rest, env, io, deps);
      case 'eval':
        return await evalCommand(rest, env, io, deps);
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
