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

const isTest = (p: string) => /\.test\.tsx?$/.test(p);
const sources = (dir: string, opts: { tests: boolean; ext?: RegExp } = { tests: false }) =>
  walk(dir).filter((p) => (opts.ext ?? /\.tsx?$/).test(p) && (opts.tests || !isTest(p)));

/** Returns "file: pattern" for every file that matches any pattern. */
function offenders(files: string[], patterns: (string | RegExp)[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const p of patterns) {
      if (typeof p === 'string' ? text.includes(p) : p.test(text)) {
        out.push(`${file.replace(repoRoot + '/', '')}: ${String(p)}`);
      }
    }
  }
  return out;
}

describe('privacy scan: user data never reaches the LLM path', () => {
  it('label/, eval/, extract/ never reference user or quiz data', () => {
    const files = ['label', 'eval', 'extract'].flatMap((d) => sources(join(srcRoot, d)));
    expect(files.length).toBeGreaterThan(0);
    expect(
      offenders(files, [
        'userSkills',
        'quizAnswers',
        'levels/',
        "from '../levels",
        /['"]\.\.\/levels/, // also bare side-effect imports
        'fixtureQuiz',
        'user_skills',
        'quiz_answers',
      ]),
    ).toEqual([]);
  });

  it('levels/ never reaches into label/ or eval/ or uses the labeler', () => {
    const files = sources(join(srcRoot, 'levels'));
    expect(files.length).toBeGreaterThan(0);
    expect(offenders(files, ["from '../label", "from '../eval", 'Labeler', 'generateObject'])).toEqual([]);
  });

  it('api onboarding and profile (including tests) never touch the labeler', () => {
    const files = ['onboarding', 'profile'].flatMap((d) =>
      sources(join(repoRoot, 'apps/api/src', d), { tests: true }),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(offenders(files, ['Labeler', 'createGeminiLabeler', 'labelPending', 'LABELER'])).toEqual([]);
  });

  it('label/ has no user or quiz parameter names', () => {
    const files = sources(join(srcRoot, 'label'));
    expect(files.length).toBeGreaterThan(0);
    expect(offenders(files, [/\b(userId|user_id|quiz)\b/])).toEqual([]);
  });

  it('web onboarding code never sees option levels', () => {
    const web = join(repoRoot, 'apps/web/src');
    const files = ['components/onboarding', 'app/onboarding'].flatMap((d) =>
      sources(join(web, d), { tests: true, ext: /\.(tsx?|css)$/ }),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(offenders(files, [/\.level\b|\blevel:/])).toEqual([]);
  });
});
