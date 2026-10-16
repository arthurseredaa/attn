import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = fileURLToPath(new URL('..', import.meta.url)); // packages/core/src
const repoRoot = join(srcRoot, '..', '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Non-test .ts files under a directory of packages/core/src. */
const sources = (sub: string) => walk(join(srcRoot, sub)).filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts'));
const rel = (p: string) => p.replace(repoRoot + '/', '');

function offenders(files: string[], patterns: (string | RegExp)[], strip = false): string[] {
  const out: string[] = [];
  for (const file of files) {
    let text = readFileSync(file, 'utf8');
    if (strip)
      text = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\/\/.*$/gm, '');
    for (const p of patterns) {
      if (typeof p === 'string' ? text.includes(p) : p.test(text)) out.push(`${rel(file)}: ${String(p)}`);
    }
  }
  return out;
}

describe('privacy scan: ranking and events stay off the LLM path', () => {
  it('rank/, demo/, levels/events.ts and levels/feedback.ts never reach label, eval or extract', () => {
    const files = [
      ...sources('rank'),
      ...sources('demo'),
      join(srcRoot, 'levels', 'events.ts'),
      join(srcRoot, 'levels', 'feedback.ts'),
    ];
    expect(files.length).toBeGreaterThan(4);
    expect(offenders(files, [/['"]\.\.\/(label|eval|extract)\b/, 'Labeler', 'generateObject', '@ai-sdk'])).toEqual([]);
  });

  it('label/, eval/ and extract/ never reach ranking, events or user tables', () => {
    const files = [...sources('label'), ...sources('eval'), ...sources('extract')];
    expect(files.length).toBeGreaterThan(0);
    const forbidden = [
      /['"]\.\.\/(rank|levels)\b/,
      'createSqlRanker',
      'recordEvent',
      'article_events',
      'articleEvents',
      'user_skills',
      'userSkills',
    ];
    expect(offenders(files, forbidden)).toEqual([]);
  });

  it('rank/ has no role vocabulary (comments ignored)', () => {
    const files = sources('rank');
    expect(files.some((f) => f.endsWith('fixtures.ts'))).toBe(true);
    expect(offenders(files, [/\brole/i, "'dev'", 'roleSkillIds'], true)).toEqual([]);
  });

  it('the feed UI shows no level, interest or points internals', () => {
    for (const f of ['feed-card.tsx', 'feed-list.tsx']) {
      const path = join(repoRoot, 'apps', 'web', 'src', 'components', f);
      expect(readFileSync(path, 'utf8'), f).not.toMatch(/\b(level|interest|points)\b/);
    }
  });
});
