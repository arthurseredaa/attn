import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('label/ privacy boundary', () => {
  it('scans at least 4 source files', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    it(`${f} imports nothing DB-touching`, () => {
      expect(src).not.toMatch(/from\s+['"][^'"]*(\/db|\/pipeline|drizzle-orm|\/quiz|\/levels|\/rank)/);
    });
    it(`${f} mentions no user-side identifiers`, () => {
      expect(src).not.toMatch(/\b(userSkills|quizAnswers|sessions|users|userId)\b/);
    });
  }
});
