import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CachedText {
  url: string;
  title: string;
  text: string;
  wordCount: number;
  fetchedAt: string;
}

export interface TextCache {
  get(url: string): Promise<CachedText | null>;
  set(entry: CachedText): Promise<void>;
}

const fileFor = (dir: string, url: string) =>
  path.join(dir, `${crypto.createHash('sha256').update(url).digest('hex').slice(0, 32)}.json`);

export function createTextCache(dir: string): TextCache {
  return {
    async get(url) {
      try {
        const parsed = JSON.parse(await fs.promises.readFile(fileFor(dir, url), 'utf8')) as Partial<CachedText> | null;
        if (
          parsed?.url !== url ||
          typeof parsed.title !== 'string' ||
          typeof parsed.text !== 'string' ||
          typeof parsed.wordCount !== 'number' ||
          typeof parsed.fetchedAt !== 'string'
        ) {
          return null;
        }
        return parsed as CachedText;
      } catch {
        return null;
      }
    },
    async set(entry) {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(fileFor(dir, entry.url), JSON.stringify(entry));
    },
  };
}

export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ATTN_CACHE_DIR) return env.ATTN_CACHE_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../..', '.cache', 'text');
}
