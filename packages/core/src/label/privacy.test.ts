import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('label/ privacy boundary', () => {
  it('scans at least 6 source files', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    it(`${f} imports nothing DB-touching`, () => {
      // static `from '...'`, side-effect `import '...'`, dynamic `import('...')` and `require('...')`
      const forbidden =
        /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"][^'"]*(\/db|\/pipeline|drizzle-orm|\/quiz|\/levels|\/rank)/;
      expect(src).not.toMatch(forbidden);
    });
    it(`${f} mentions no user-side identifiers`, () => {
      expect(src).not.toMatch(/\b(userSkills|quizAnswers|sessions|users|userId)\b/);
    });
  }
});
