import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadQuiz } from './data';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attn-quiz-'));
  fs.mkdirSync(path.join(dir, 'quiz'));
  const levels = [0, 1, 2, 3, 4].map((l) => `  - {level: ${l}, label: L${l}, description: d}`).join('\n');
  const skills = ['a', 'b'].map((id) => `      - {id: ${id}, name: ${id}, description: x, roles: [dev]}`).join('\n');
  fs.writeFileSync(
    path.join(dir, 'taxonomy.yml'),
    `version: 1\nlevels:\n${levels}\ndomains:\n  - id: d\n    name: D\n    skills:\n${skills}\n`,
  );
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const question = (id: string, skill: string, levels: number[]) =>
  `  - id: ${id}\n    skill_id: ${skill}\n    situation: s\n    options:\n` +
  levels.map((l, i) => `      - {text: "${id} opt ${i}", level: ${l}}`).join('\n') +
  '\n';
const writeQuiz = (body: string) => fs.writeFileSync(path.join(dir, 'quiz/dev.yml'), body);

describe('loadQuiz', () => {
  it('returns the parsed bank', () => {
    writeQuiz(`version: 3\nquestions:\n${question('a-1', 'a', [2, 0, 4, 1])}${question('a-2', 'a', [3, 1, 0, 4])}`);
    const quiz = loadQuiz('dev', dir);
    expect(quiz.version).toBe(3);
    expect(quiz.questions.map((x) => x.id)).toEqual(['a-1', 'a-2']);
  });

  it('names the file and the issue for an unknown skill', () => {
    writeQuiz(`version: 1\nquestions:\n${question('z-1', 'z', [2, 0, 4, 1])}${question('z-2', 'z', [3, 1, 0, 4])}`);
    expect(() => loadQuiz('dev', dir)).toThrow(/quiz\/dev\.yml/);
    expect(() => loadQuiz('dev', dir)).toThrow(/unknown skill_id z/);
  });

  it('names the file for malformed YAML or a missing version', () => {
    writeQuiz('version: [\n');
    expect(() => loadQuiz('dev', dir)).toThrow(/quiz\/dev\.yml/);
    writeQuiz(`questions:\n${question('a-1', 'a', [2, 0, 4, 1])}`);
    expect(() => loadQuiz('dev', dir)).toThrow(/quiz\/dev\.yml/);
  });

  it('throws ENOENT when the role file is missing', () => {
    expect(() => loadQuiz('nope', dir)).toThrow(/ENOENT|no such file/i);
  });
});
