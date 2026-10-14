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

/** Patterns that must never appear in label/, eval/ or extract/ (non-test sources). */
const LLM_PATH_FORBIDDEN: (string | RegExp)[] = [
  'levels/',
  /['"](\.{1,2}\/)+levels\b/, // ./levels, ../levels, ../../levels, also bare side-effect imports
  /['"]@attn\/core(\/[^'"]*)?['"]/, // the core barrel re-exports levels and every table
  // imports of '..', '../..', '../index': the core barrel again (a bare '..' path string is fine)
  /(\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.\.\/)*\.\.(\/index(\.ts)?)?['"]/,
  'fixtureQuiz',
  /\b(userSkills|quizAnswers|users|sessions|articleEvents)\b/, // user-bearing tables (drizzle names)
  /\b(user_skills|quiz_answers|article_events)\b/, // the same tables in raw SQL
];

const matches = (line: string) =>
  LLM_PATH_FORBIDDEN.some((p) => (typeof p === 'string' ? line.includes(p) : p.test(line)));

describe('privacy scan: user data never reaches the LLM path', () => {
  it('the forbidden patterns catch every way in and spare the allowed imports', () => {
    const caught = [
      "import { presentQuiz } from '../levels';",
      "import { presentQuiz } from './levels';",
      "import { presentQuiz } from '../../levels';",
      "import '../levels/store';",
      "import { userSkills } from '@attn/core';",
      "import { testDb } from '@attn/core/testing';",
      "import { users } from '..';",
      "import { users } from '../index';",
      "import { users } from '../../index';",
      "import * as core from '../..';",
      "export * from '..';",
      "const core = await import('..');",
      "import '..';",
      'db.select().from(users)',
      'db.select().from(sessions)',
      'db.insert(articleEvents)',
      'db.select().from(quizAnswers)',
      'sql`select * from article_events`',
      'sql`select level from user_skills`',
      'sql`select * from quiz_answers`',
    ];
    const allowed = [
      "import { labelArticle } from '../label';",
      "import { loadTaxonomy } from '../data';",
      "import { fetchText } from '../collect/http';",
      "import type { Labeler } from './types';",
      "import { articleHtml } from '../../extract/fixtures/html';",
      "import { z } from 'zod';",
      "import type { Taxonomy } from '@attn/shared';",
      'const skills = taxonomy.domains.flatMap((d) => d.skills);',
      "return path.resolve(here, '../../../..', '.cache', 'text');",
    ];
    expect(caught.filter((l) => !matches(l))).toEqual([]);
    expect(allowed.filter(matches)).toEqual([]);
  });

  it('label/, eval/, extract/ never reference user or quiz data', () => {
    const files = ['label', 'eval', 'extract'].flatMap((d) => sources(join(srcRoot, d)));
    expect(files.length).toBeGreaterThan(0);
    expect(offenders(files, LLM_PATH_FORBIDDEN)).toEqual([]);
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
