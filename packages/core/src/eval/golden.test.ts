import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { loadTaxonomy } from '../data';
import { loadGolden } from './golden';
import { readEvalFixture } from './fixtures/load';

const taxonomy = loadTaxonomy();
const dirs: string[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'attn-golden-'));
  dirs.push(d);
  return d;
}

function setup(files: Record<string, string>): string {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'golden'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'golden', name), content);
  return dir;
}

const item = (over: Record<string, unknown> = {}) => ({
  url: 'http://x.test/a',
  primary_skill: 'cc-hooks',
  difficulty: 1,
  type: 'tutorial',
  quality: 2,
  ...over,
});

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('loadGolden', () => {
  it('loads files in name order and tags entries with their file', () => {
    const items = parse(readEvalFixture('golden.yml', 'http://x.test')) as unknown[];
    const dir = setup({ 'b.yml': stringify(items.slice(2)), 'a.yml': stringify(items.slice(0, 2)) });
    const entries = loadGolden(dir, taxonomy);
    expect(entries.map((e) => [e.file, e.url])).toEqual([
      ['a.yml', 'http://x.test/g1'],
      ['a.yml', 'http://x.test/g2'],
      ['b.yml', 'http://x.test/g3'],
      ['b.yml', 'http://x.test/g4'],
    ]);
  });

  it('defaults secondary_skills to []', () => {
    const dir = setup({ 'a.yml': stringify([item()]) });
    expect(loadGolden(dir, taxonomy)[0]?.secondary_skills).toEqual([]);
  });

  it('returns [] for a missing dir, only .gitkeep, or a comment-only file', () => {
    expect(loadGolden(tmp(), taxonomy)).toEqual([]);
    expect(loadGolden(setup({ '.gitkeep': '' }), taxonomy)).toEqual([]);
    expect(loadGolden(setup({ 'a.yml': '# nothing yet\n' }), taxonomy)).toEqual([]);
  });

  it('throws with the file path on a schema violation', () => {
    const dir = setup({ 'a.yml': stringify([item({ difficulty: 9 })]) });
    expect(() => loadGolden(dir, taxonomy)).toThrow(path.join(dir, 'golden', 'a.yml'));
  });

  it('throws naming file, url and id on an unknown skill', () => {
    const dir = setup({ 'a.yml': stringify([item({ primary_skill: 'nope' })]) });
    expect(() => loadGolden(dir, taxonomy)).toThrow(/a\.yml.*http:\/\/x\.test\/a.*nope/s);
    const dir2 = setup({ 'a.yml': stringify([item({ secondary_skills: ['nope'] })]) });
    expect(() => loadGolden(dir2, taxonomy)).toThrow(/a\.yml.*http:\/\/x\.test\/a.*nope/s);
  });

  it('rejects the same URL (after normalization) in two files', () => {
    const dir = setup({
      'a.yml': stringify([item()]),
      'b.yml': stringify([item({ url: 'http://x.test/a/?utm_source=x' })]),
    });
    expect(() => loadGolden(dir, taxonomy)).toThrow(/a\.yml/);
    expect(() => loadGolden(dir, taxonomy)).toThrow(/b\.yml/);
  });

  it('ignores non-.yml files', () => {
    const dir = setup({ 'notes.txt': 'not yaml: [', 'a.yml': stringify([item()]) });
    expect(loadGolden(dir, taxonomy)).toHaveLength(1);
  });

  it("loads the repo's real data/golden", () => {
    expect(() => loadGolden()).not.toThrow();
  });
});
