import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir, loadConfig, loadSources, loadTaxonomy } from './data';

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
