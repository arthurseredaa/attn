import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  configSchema,
  sourcesSchema,
  taxonomySchema,
  type Config,
  type Source,
  type Taxonomy,
} from '@attn/shared';

export function dataDir(): string {
  return process.env.ATTN_DATA_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
}

interface Schema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

function loadYaml<T>(file: string, schema: Schema<T>, dir: string): T {
  const full = path.join(dir, file);
  let raw: unknown;
  try {
    raw = parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    throw new Error(`${full}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new Error(`${full}: ${result.error.message}`);
  return result.data;
}

export const loadTaxonomy = (dir: string = dataDir()): Taxonomy => loadYaml('taxonomy.yml', taxonomySchema, dir);
export const loadSources = (dir: string = dataDir()): Source[] => loadYaml('sources.yml', sourcesSchema, dir);
export const loadConfig = (dir: string = dataDir()): Config => loadYaml('config.yml', configSchema, dir);
