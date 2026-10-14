import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTextCache, defaultCacheDir, type CachedText } from './cache';

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'attn-cache-'));
  dirs.push(d);
  return d;
};
const entry = (url: string, text = 'hello world'): CachedText => ({
  url,
  title: 'T',
  text,
  wordCount: 2,
  fetchedAt: '2026-10-14T00:00:00.000Z',
});

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('text cache', () => {
  it('misses on empty', async () => {
    expect(await createTextCache(tmp()).get('http://x.test/a')).toBeNull();
  });

  it('round-trips all fields', async () => {
    const cache = createTextCache(tmp());
    await cache.set(entry('http://x.test/a'));
    expect(await cache.get('http://x.test/a')).toEqual(entry('http://x.test/a'));
  });

  it('creates a missing nested directory', async () => {
    const dir = path.join(tmp(), 'a', 'b');
    await createTextCache(dir).set(entry('http://x.test/a'));
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });

  it('keeps URLs apart and overwrites the same URL', async () => {
    const dir = tmp();
    const cache = createTextCache(dir);
    await cache.set(entry('http://x.test/a'));
    await cache.set(entry('http://x.test/b'));
    expect(fs.readdirSync(dir)).toHaveLength(2);
    await cache.set(entry('http://x.test/a', 'new text'));
    expect(fs.readdirSync(dir)).toHaveLength(2);
    expect((await cache.get('http://x.test/a'))?.text).toBe('new text');
  });

  it('treats a corrupt file as a miss', async () => {
    const dir = tmp();
    const cache = createTextCache(dir);
    await cache.set(entry('http://x.test/a'));
    const [file] = fs.readdirSync(dir);
    fs.writeFileSync(path.join(dir, file!), 'not json');
    expect(await cache.get('http://x.test/a')).toBeNull();
  });
});

describe('defaultCacheDir', () => {
  it('is <repo root>/.cache/text', () => {
    const dir = defaultCacheDir({});
    expect(dir.endsWith('/.cache/text')).toBe(true);
    const root = path.join(dir, '..', '..');
    expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))).toBe(true);
  });

  it('honors ATTN_CACHE_DIR', () => {
    expect(defaultCacheDir({ ATTN_CACHE_DIR: '/tmp/x' })).toBe('/tmp/x');
  });
});
