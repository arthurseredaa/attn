import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir, loadConfig, loadQuizBanks, loadSources, loadTaxonomy } from './data';

let dir: string;
let priorEnv: string | undefined;
beforeEach(() => {
  priorEnv = process.env.ATTN_DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attn-data-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  if (priorEnv === undefined) delete process.env.ATTN_DATA_DIR;
  else process.env.ATTN_DATA_DIR = priorEnv;
});

const write = (name: string, body: string) => fs.writeFileSync(path.join(dir, name), body);

describe('data loaders', () => {
  it('loadSources returns the parsed array', () => {
    write('sources.yml', '- id: a\n  name: A\n  type: rss\n  url: https://x.test/feed\n');
    expect(loadSources(dir)).toEqual([{ id: 'a', name: 'A', type: 'rss', url: 'https://x.test/feed' }]);
  });

  it('loadTaxonomy returns a valid minimal taxonomy', () => {
    const levels = [0, 1, 2, 3, 4].map((l) => `  - {level: ${l}, label: L${l}, description: d}`).join('\n');
    write(
      'taxonomy.yml',
      `version: 1\nlevels:\n${levels}\ndomains:\n  - id: d\n    name: D\n    skills:\n      - {id: s, name: S, description: x, roles: [dev]}\n`,
    );
    const t = loadTaxonomy(dir);
    expect(t.domains[0]?.skills[0]?.id).toBe('s');
  });

  it('loadConfig names the file when validation fails', () => {
    write('config.yml', 'backfill_days: -1\n');
    expect(() => loadConfig(dir)).toThrow(/config\.yml/);
  });

  it('throws naming the file when it is missing', () => {
    expect(() => loadSources(dir)).toThrow(/sources\.yml/);
  });

  it('dataDir honors ATTN_DATA_DIR', () => {
    process.env.ATTN_DATA_DIR = '/somewhere/else';
    expect(dataDir()).toBe('/somewhere/else');
  });

  it('dataDir defaults to repo-root data/', () => {
    delete process.env.ATTN_DATA_DIR;
    const repoData = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
    expect(dataDir()).toBe(repoData);
    expect(fs.existsSync(path.join(repoData, 'sources.yml'))).toBe(true);
  });
});

describe('loadQuizBanks', () => {
  const levels = [0, 1, 2, 3, 4].map((l) => `  - {level: ${l}, label: L${l}, description: d}`).join('\n');
  const question = (id: string, skill: string) =>
    `  - id: ${id}\n    skill_id: ${skill}\n    situation: s\n    options:\n` +
    [2, 0, 4, 1].map((l, i) => `      - {text: "${id} opt ${i}", level: ${l}}`).join('\n') +
    '\n';
  beforeEach(() => {
    write(
      'taxonomy.yml',
      `version: 1\nlevels:\n${levels}\ndomains:\n  - id: d\n    name: D\n    skills:\n` +
        '      - {id: a, name: A, description: x, roles: [dev]}\n' +
        '      - {id: b, name: B, description: x, roles: [pm, ops]}\n',
    );
    fs.mkdirSync(path.join(dir, 'quiz'));
  });

  it('loads data/quiz/<role>.yml for every taxonomy role that has one', () => {
    write('quiz/dev.yml', `version: 2\nquestions:\n${question('a-1', 'a')}${question('a-2', 'a')}`);
    write('quiz/pm.yml', `version: 5\nquestions:\n${question('b-1', 'b')}${question('b-2', 'b')}`);
    const banks = loadQuizBanks(dir);
    expect([...banks.keys()].sort()).toEqual(['dev', 'pm']);
    expect(banks.get('dev')!.questions.map((q) => q.id)).toEqual(['a-1', 'a-2']);
    expect(banks.get('pm')!.version).toBe(5);
    expect(banks.has('ops')).toBe(false);
  });

  it('throws naming the file when a role bank is invalid', () => {
    write('quiz/dev.yml', `version: 1.5\nquestions:\n${question('a-1', 'a')}${question('a-2', 'a')}`);
    expect(() => loadQuizBanks(dir)).toThrow(/quiz\/dev\.yml/);
  });

  it('the real data has a bank for every role', () => {
    const roles = [...new Set(loadTaxonomy().domains.flatMap((d) => d.skills.flatMap((s) => s.roles)))];
    expect(roles).toEqual(['dev']);
    expect([...loadQuizBanks().keys()]).toEqual(roles);
  });
});
