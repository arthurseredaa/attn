import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN = /Labeler|createGeminiLabeler|labelPending|LABELER/;
const root = join(__dirname, '..');

function tsFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
      .map((e) => join(e.parentPath, e.name));
  } catch {
    return [];
  }
}

describe('privacy invariant', () => {
  it('auth, articles, feed and events never reference the labeler', () => {
    const dirs = ['auth', 'articles', 'feed', 'events'];
    const files = dirs.flatMap((d) => tsFiles(join(root, d)));
    for (const d of dirs) expect(tsFiles(join(root, d)).length, d).toBeGreaterThan(0);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(FORBIDDEN);
  });
});
