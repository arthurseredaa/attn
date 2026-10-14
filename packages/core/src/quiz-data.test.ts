import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quizCoverageIssues } from '@attn/shared';
import { dataDir, loadQuiz, loadTaxonomy } from './data';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attn-quiz-'));
  fs.mkdirSync(path.join(dir, 'quiz'));
  const levels = [0, 1, 2, 3, 4]
    .map((l) => `  - {level: ${l}, label: L${l}, description: d}`)
    .join('\n');
  const skills = ['a', 'b']
    .map(
      (id) => `      - {id: ${id}, name: ${id}, description: x, roles: [dev]}`,
    )
    .join('\n');
  fs.writeFileSync(
    path.join(dir, 'taxonomy.yml'),
    `version: 1\nlevels:\n${levels}\ndomains:\n  - id: d\n    name: D\n    skills:\n${skills}\n`,
  );
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const question = (id: string, skill: string, levels: number[]) =>
  `  - id: ${id}\n    skill_id: ${skill}\n    situation: s\n    options:\n` +
  levels
    .map((l, i) => `      - {text: "${id} opt ${i}", level: ${l}}`)
    .join('\n') +
  '\n';
const writeQuiz = (body: string) =>
  fs.writeFileSync(path.join(dir, 'quiz/dev.yml'), body);

describe('loadQuiz', () => {
  it('returns the parsed bank', () => {
    writeQuiz(
      `version: 3\nquestions:\n${question('a-1', 'a', [2, 0, 4, 1])}${question('a-2', 'a', [3, 1, 0, 4])}`,
    );
    const quiz = loadQuiz('dev', dir);
    expect(quiz.version).toBe(3);
    expect(quiz.questions.map((x) => x.id)).toEqual(['a-1', 'a-2']);
  });

  it('names the file and the issue for an unknown skill', () => {
    writeQuiz(
      `version: 1\nquestions:\n${question('z-1', 'z', [2, 0, 4, 1])}${question('z-2', 'z', [3, 1, 0, 4])}`,
    );
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

const DRAFT_HEADER = [
  '# DRAFT quiz bank: drafted by Claude (2026-10-14), NOT reviewed by the project owner.',
  '# The owner must review every question and every option level before this bank is trusted:',
  "# check that the situation is realistic, that each option's hidden level (0-4, the shared level scale)",
  '# matches what the option shows about the person, and that wrong-sounding options are not obviously wrong.',
  '# Once reviewed, remove this header. Levels are hidden: they never leave the server.',
];
const PART_1 = [
  'context-engineering',
  'cc-skills-commands',
  'cc-hooks',
  'cc-subagents',
  'cc-plugins',
  'cc-mcp-usage',
  'cc-headless-ci',
  'parallel-agents',
  'spec-driven-workflow',
  'agent-verification',
  'tool-use-loop',
  'agent-sdk',
  'mcp-server-build',
  'multi-agent-orchestration',
  'human-in-the-loop',
  'workflow-automation',
];

describe('real quiz bank', () => {
  // loaded once: every test below only reads the bank
  const bank = loadQuiz();
  const taxonomy = loadTaxonomy();

  it('loads without schema or bank issues', () => {
    expect(() => loadQuiz()).not.toThrow();
  });

  it('keeps the DRAFT header verbatim while it is present', () => {
    const lines = fs
      .readFileSync(path.join(dataDir(), 'quiz/dev.yml'), 'utf8')
      .split('\n');
    if (lines[0]?.startsWith('# DRAFT'))
      expect(lines.slice(0, 5)).toEqual(DRAFT_HEADER);
  });

  const skillOrder = () =>
    taxonomy.domains.flatMap((d) => d.skills.map((s) => s.id));

  it('covers every dev skill of the taxonomy', () => {
    expect(quizCoverageIssues(bank, taxonomy, 'dev')).toEqual([]);
  });

  it('has 64 questions, exactly <skill>-1 and <skill>-2 for every taxonomy skill', () => {
    const qs = bank.questions;
    expect(qs).toHaveLength(64);
    for (const skill of skillOrder()) {
      expect(
        qs
          .filter((q) => q.skill_id === skill)
          .map((q) => q.id)
          .sort(),
        skill,
      ).toEqual([`${skill}-1`, `${skill}-2`]);
    }
  });

  it("orders the whole bank by taxonomy, each skill's -1 before its -2", () => {
    const ids = bank.questions.map((q) => q.id);
    expect(ids).toEqual(skillOrder().flatMap((s) => [`${s}-1`, `${s}-2`]));
  });

  it('does not copy one question of a skill into the other (situation and option texts differ)', () => {
    const qs = bank.questions;
    for (const skill of skillOrder()) {
      const [a, b] = qs.filter((q) => q.skill_id === skill);
      if (!a || !b) throw new Error(`${skill}: missing questions`);
      expect(a.situation, skill).not.toBe(b.situation);
      const textsA = new Set(a.options.map((o) => o.text.trim().toLowerCase()));
      const shared = b.options.filter((o) =>
        textsA.has(o.text.trim().toLowerCase()),
      );
      expect(shared, skill).toEqual([]);
    }
  });

  it('uses every level 0-4 for at least 5% of the options in the whole bank', () => {
    const levels = bank.questions.flatMap((q) =>
      q.options.map((o) => o.level),
    );
    for (const level of [0, 1, 2, 3, 4]) {
      expect(
        levels.filter((l) => l === level).length / levels.length,
        `level ${level}`,
      ).toBeGreaterThanOrEqual(0.05);
    }
  });

  it('uses every level 0-4 across the part-1 bank', () => {
    const levels = new Set(
      bank.questions
        .filter((q) => PART_1.includes(q.skill_id))
        .flatMap((q) => q.options.map((o) => o.level)),
    );
    expect([...levels].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps texts short enough for the UI', () => {
    for (const q of bank.questions) {
      expect(q.situation.length, q.id).toBeLessThanOrEqual(500);
      for (const o of q.options)
        expect(o.text.length, `${q.id}: ${o.text}`).toBeLessThanOrEqual(280);
    }
  });

  describe('length and wording guards', () => {
    const questions = () => bank.questions;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const pearson = (xs: number[], ys: number[]) => {
      const mx = mean(xs);
      const my = mean(ys);
      let num = 0;
      let dx = 0;
      let dy = 0;
      xs.forEach((x, i) => {
        const y = ys[i] ?? 0;
        num += (x - mx) * (y - my);
        dx += (x - mx) ** 2;
        dy += (y - my) ** 2;
      });
      return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
    };

    it('does not make the longest option the top level in more than 35% of questions', () => {
      const qs = questions();
      const hits = qs.filter((q) => {
        const lengths = q.options.map((o) => o.text.length);
        const top = Math.max(...q.options.map((o) => o.level));
        return q.options[lengths.indexOf(Math.max(...lengths))]?.level === top;
      });
      expect(hits.length / qs.length).toBeLessThanOrEqual(0.35);
    });

    it('keeps option length uncorrelated with level (mean Pearson r within +-0.3)', () => {
      const rs = questions().map((q) =>
        pearson(
          q.options.map((o) => o.text.length),
          q.options.map((o) => o.level),
        ),
      );
      expect(Math.abs(mean(rs))).toBeLessThanOrEqual(0.3);
    });

    it('keeps the mean option length of every level within 10% of the overall mean', () => {
      const all = questions().flatMap((q) => q.options);
      const overall = mean(all.map((o) => o.text.length));
      for (const level of [0, 1, 2, 3, 4]) {
        const m = mean(
          all.filter((o) => o.level === level).map((o) => o.text.length),
        );
        expect(
          Math.abs(m - overall) / overall,
          `level ${level}`,
        ).toBeLessThanOrEqual(0.1);
      }
    });

    it('keeps options within 15% of their question mean length', () => {
      for (const q of questions()) {
        const m = mean(q.options.map((o) => o.text.length));
        for (const o of q.options) {
          expect(
            Math.abs(o.text.length - m) / m,
            `${q.id}: ${o.text}`,
          ).toBeLessThanOrEqual(0.15);
        }
      }
    });

    type Opt = { text: string; level: number };
    type Q = { id: string; options: Opt[] };
    const allOptions = () => questions().flatMap((q) => q.options);
    const lengthRank = (q: Q, i: number) => {
      const lengths = q.options.map((o) => o.text.length);
      return (
        lengths.filter((l) => l < (lengths[i] ?? 0)).length /
        (lengths.length - 1)
      );
    };

    const PRONOUN = /\b(I|my|me|myself|we|our|us|mine)\b/i;
    const REASON = /\b(since|because|so|as|which|in case|in order to)\b/i;
    const FILLER =
      /\b(then done|anyway|figure|maybe|probably|just|simply|hope|hopefully|somehow|whatever|for now|see how|at all|and move on)\b/i;
    const ENGINEERING = new RegExp(
      '\\b(' +
        [
          'ci',
          'hooks?',
          'scripts?',
          'tests?',
          'lint\\w*',
          'schemas?',
          'sandbox\\w*',
          'tokens?',
          'prs?',
          'diffs?',
          'logs?',
          'configs?',
          'flags?',
          'prompts?',
          'branch\\w*',
          'commits?',
          'evals?',
          'fixtures?',
          'mocks?',
          'pipelines?',
          'deploy\\w*',
          'permissions?',
          'allowlists?',
          'mcp',
          'sdk',
          'containers?',
          'worktrees?',
          'tools?',
          'workflows?',
          'repos?',
          'plugins?',
          'subagents?',
          'cron',
          'json',
          'api',
          'oauth',
          'servers?',
          'settings',
        ].join('|') +
        ')\\b',
      'gi',
    );
    const count = (re: RegExp, text: string) => text.match(re)?.length ?? 0;

    // Word lists copied verbatim from the reviewer's heuristic scripts (heur3.py, heur2r.py, extra3.py).
    // They were fixed a priori by the reviewer: do not tune them to the bank text.
    /** Round-2 fixed 10-word mechanism list (R2b). */
    const NARROW_10 =
      /\b(hooks?|CI|scripts?|tests?|validat\w*|schema|sandbox\w*|containers?|fail\w*|block\w*)\b/gi;
    /** The 10-word list plus check/reject/deny/require (re-review 3, question 2). */
    const NARROW_CONTROL =
      /\b(hooks?|CI|scripts?|tests?|validat\w*|schema|sandbox\w*|containers?|fail\w*|block\w*|check\w*|reject\w*|den(y|ies|ying)|require\w*)\b/gi;
    /** Low-level markers subtracted twice from the 10-word list (R2). */
    const NARROW_LOW = /(by hand|paste|\bask|docs|example)/gi;
    /** Round-2 broad mechanism list (R3b). */
    const BROAD_MECHANISM =
      /\b(hooks?|CI|scripts?|schema|validat\w*|containers?|sandbox\w*|proxy|tests?|replay|compare|fail|block\w*|outside|own|JSON|OAuth|HTTP|generate|build|wrap\w*|pool|enforce|policy|layer|conformance|baseline|offline|parse|syntax|release|alert\w*|cap|budget|limit)\b/gi;
    /** Low-level markers subtracted twice from the broad list (R3). */
    const BROAD_LOW =
      /(by hand|paste|\bask|docs|example|README|instructions|keep (doing|going|copying)|leave|let it|trust|retry|rerun|skim|quick-start|template|gallery|;|myself|exactly as)/gi;
    /** Creation-verb opener (N2b), case-sensitive like the script. */
    const CREATION_OPENER =
      /^(Build|Wrap|Move|Isolate|Sandbox|Generate|Replay|Split|Enforce|Compute|Put|Publish|Define|Make|Create|Write|Add|Design|Serve|Keep a|Mark|Assign|Cut)\b/;
    /** Boundary words (N3). */
    const BOUNDARY =
      /\b(outside|separate\w*|own|before (merg\w*|commit|release|execution|each)|independent|clean|isolat\w*|per[- ]\w+|only)\b/gi;
    /** Control / enforcement verbs (N5). */
    const CONTROL =
      /\b(fail\w*|block\w*|reject\w*|den(y|ies|ying)|restrict\w*|limit\w*|forbid\w*|require\w*|enforce\w*|validat\w*|check\w*|cap)\b/gi;
    /** Wide inaction / manual words (N4b). */
    const INACTION =
      /\b(skip|leave|ignore|let|accept|stay|keep (working|going|doing)|manually|by hand|paste|ask|watch|scroll|skim|retry|rerun|once)\b/gi;
    const THAT = /\bthat\b/gi;
    /** Fixed list of 79 English function words (rule 28). Chosen a priori: do not tune it to the bank text. */
    const FUNCTION_WORDS = new Set(
      (
        'a an the and or but nor if then than to of in on at by for with from into onto over under ' +
        'about after before until while as that this these those it its each every all any some no not both ' +
        'either one there their they them be is are was were can will would should must do does so up out off ' +
        'per via through between against without within when where whose which who what'
      ).split(' '),
    );
    /** Operator-verb opener (rule 28): verbs that run, check or copy something rather than build it. */
    const OPERATOR_OPENER =
      /^(Run|Check|Ask|Copy|Follow|Accept|Merge|Keep|Triage|Export|Share|Tell|Retry|Restore|Review|Print|Compare|Stop|Open|Finish|Install|Clear|Ignore|Skip|Let|Ship|Chain|Extend|Describe|Import|Rename|Rerun|Reword|Tighten|Use|Disable|Read)\b/;
    const wordTokens = (t: string) => t.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];

    const FEATURES: Record<string, (text: string) => number> = {
      pronoun: (t) => count(new RegExp(PRONOUN.source, 'gi'), t),
      semicolons: (t) => count(/;/g, t),
      sentences: (t) => count(/[.!?](\s|$)/g, t),
      pastTenseOpener: (t) => (/ed$/i.test(t.split(' ')[0] ?? '') ? 1 : 0),
      filler: (t) => count(new RegExp(FILLER.source, 'gi'), t),
      reason: (t) => count(new RegExp(REASON.source, 'gi'), t),
      engineering: (t) => count(ENGINEERING, t),
      length: (t) => t.length,
      commas: (t) => count(/,/g, t),
      words: (t) => t.split(/\s+/).length,
      narrow10: (t) => count(NARROW_10, t),
      narrow10MinusLow: (t) => count(NARROW_10, t) - 2 * count(NARROW_LOW, t),
      narrowControl: (t) => count(NARROW_CONTROL, t),
      broadMechanism: (t) => count(BROAD_MECHANISM, t),
      broadMinusLow: (t) => count(BROAD_MECHANISM, t) - 2 * count(BROAD_LOW, t),
      creationOpener: (t) => (CREATION_OPENER.test(t) ? 1 : 0),
      boundary: (t) => count(BOUNDARY, t),
      control: (t) => count(CONTROL, t),
      thatClauses: (t) => count(THAT, t),
      thatControl: (t) => count(THAT, t) + count(CONTROL, t),
      inaction: (t) => count(INACTION, t),
      narrowBoundaryMinusInaction: (t) =>
        count(NARROW_10, t) + count(BOUNDARY, t) - count(INACTION, t),
      engineeringBoundaryMinusInaction: (t) =>
        count(ENGINEERING, t) + count(BOUNDARY, t) - count(INACTION, t),
      definiteArticles: (t) => count(/\bthe\b/gi, t),
      articles: (t) => count(/\b(a|an|the)\b/gi, t),
      functionWordRatio: (t) => {
        const words = wordTokens(t);
        return (
          words.filter((w) => FUNCTION_WORDS.has(w.toLowerCase())).length /
          words.length
        );
      },
      operatorOpener: (t) => (OPERATOR_OPENER.test(t) ? 1 : 0),
    };

    /** Expected hit rate of a blind guess and the rate of a solver that picks by `score`, ties split fractionally. */
    const solverRate = (score: (o: Opt, i: number, q: Q) => number) => {
      const qs = questions();
      let hits = 0;
      let chance = 0;
      for (const q of qs) {
        const top = Math.max(...q.options.map((o) => o.level));
        const scores = q.options.map((o, i) => score(o, i, q));
        const best = Math.max(...scores);
        const picked = q.options.filter((_, i) => scores[i] === best);
        hits += picked.filter((o) => o.level === top).length / picked.length;
        chance +=
          q.options.filter((o) => o.level === top).length / q.options.length;
      }
      return { rate: hits / qs.length, chance: chance / qs.length };
    };

    /**
     * Elimination solver: drop the options with the lowest score (unless all tie) and pick uniformly among
     * the rest. Same chance as `solverRate`.
     */
    const eliminationRate = (score: (text: string) => number) => {
      const qs = questions();
      let hits = 0;
      for (const q of qs) {
        const top = Math.max(...q.options.map((o) => o.level));
        const scores = q.options.map((o) => score(o.text));
        const worst = Math.min(...scores);
        const kept = q.options.filter((_, i) => (scores[i] ?? 0) > worst);
        const pool = kept.length > 0 ? kept : q.options;
        hits += pool.filter((o) => o.level === top).length / pool.length;
      }
      return hits / qs.length;
    };

    type Mode = 'max' | 'min' | 'dropLowest' | 'dropHighest';
    /** Probability that a solver picks each option: best score (ties split) or uniform after dropping the worst. */
    const pickWeights = (scores: number[], mode: Mode) => {
      if (mode === 'max' || mode === 'min') {
        const best = mode === 'max' ? Math.max(...scores) : Math.min(...scores);
        const n = scores.filter((s) => s === best).length;
        return scores.map((s) => (s === best ? 1 / n : 0));
      }
      const worst =
        mode === 'dropLowest' ? Math.min(...scores) : Math.max(...scores);
      const keep = scores.map((s) => s !== worst);
      const pool = keep.some(Boolean) ? keep : scores.map(() => true);
      const n = pool.filter(Boolean).length;
      return pool.map((k) => (k ? 1 / n : 0));
    };
    /** Expected level of the option a solver picks, averaged over questions, and the same for a blind guess. */
    const expectedLevel = (score: (text: string) => number, mode: Mode) => {
      const qs = questions();
      let picked = 0;
      let random = 0;
      for (const q of qs) {
        const w = pickWeights(
          q.options.map((o) => score(o.text)),
          mode,
        );
        picked += q.options.reduce((s, o, i) => s + (w[i] ?? 0) * o.level, 0);
        random += mean(q.options.map((o) => o.level));
      }
      return { picked: picked / qs.length, random: random / qs.length };
    };

    it('does not make the shortest option the top level in more than 35% of questions', () => {
      const qs = questions();
      const hits = qs.filter((q) => {
        const lengths = q.options.map((o) => o.text.length);
        const top = Math.max(...q.options.map((o) => o.level));
        return q.options[lengths.indexOf(Math.min(...lengths))]?.level === top;
      });
      expect(hits.length / qs.length).toBeLessThanOrEqual(0.35);
    });

    it('keeps the mean length rank of the top option near the middle (0.5 +- 0.15)', () => {
      const ranks = questions().map((q) => {
        const top = Math.max(...q.options.map((o) => o.level));
        return lengthRank(
          q,
          q.options.findIndex((o) => o.level === top),
        );
      });
      expect(Math.abs(mean(ranks) - 0.5)).toBeLessThanOrEqual(0.15);
    });

    it('writes every option as one plain imperative sentence', () => {
      for (const o of allOptions()) {
        expect(o.text, o.text).toMatch(/^[A-Z][a-z]+ /);
        expect(FEATURES.pronoun?.(o.text), o.text).toBe(0);
        expect(FEATURES.semicolons?.(o.text), o.text).toBe(0);
        expect(FEATURES.sentences?.(o.text), o.text).toBe(1);
        expect(FEATURES.pastTenseOpener?.(o.text), o.text).toBe(0);
        expect(FEATURES.filler?.(o.text), o.text).toBe(0);
        expect(FEATURES.reason?.(o.text), o.text).toBe(0);
        expect(FEATURES.commas?.(o.text), o.text).toBeLessThanOrEqual(2);
      }
    });

    it('does not let one opening word dominate a level (<= 40%)', () => {
      const all = allOptions();
      for (const level of [0, 1, 2, 3, 4]) {
        const opts = all.filter((o) => o.level === level);
        const counts = new Map<string, number>();
        for (const o of opts) {
          const word = o.text.split(' ')[0] ?? '';
          counts.set(word, (counts.get(word) ?? 0) + 1);
        }
        expect(
          Math.max(...counts.values()) / opts.length,
          `level ${level}`,
        ).toBeLessThanOrEqual(0.4);
      }
    });

    describe.each(Object.keys(FEATURES))('feature solver: %s', (name) => {
      it.each([
        ['highest', 1],
        ['lowest', -1],
      ] as const)(
        'picking the option with the %s value stays near chance (<= chance + 0.12)',
        (_dir, sign) => {
          const f = FEATURES[name] as (t: string) => number;
          const { rate, chance } = solverRate((o) => sign * f(o.text));
          expect(rate).toBeLessThanOrEqual(chance + 0.12);
        },
      );
      it.each([
        ['lowest', 1],
        ['highest', -1],
      ] as const)(
        'dropping the options with the %s value and guessing among the rest stays near chance (<= chance + 0.12)',
        (_dir, sign) => {
          const f = FEATURES[name] as (t: string) => number;
          const { chance } = solverRate(() => 0);
          expect(eliminationRate((t) => sign * f(t))).toBeLessThanOrEqual(
            chance + 0.12,
          );
        },
      );
      it.each(['max', 'min', 'dropLowest', 'dropHighest'] as const)(
        'the %s solver does not inflate the expected chosen level (<= random + 0.30)',
        (mode) => {
          const f = FEATURES[name] as (t: string) => number;
          const { picked, random } = expectedLevel(f, mode);
          expect(picked).toBeLessThanOrEqual(random + 0.3);
        },
      );
    });

    it.each([
      'engineering',
      'control',
      'definiteArticles',
      'articles',
      'functionWordRatio',
      'operatorOpener',
    ])(
      'keeps the per-level mean of the %s feature within 20% of the overall mean',
      (name) => {
        const f = FEATURES[name] as (t: string) => number;
        const all = allOptions();
        const overall = mean(all.map((o) => f(o.text)));
        expect(overall).toBeGreaterThan(0);
        for (const level of [0, 1, 2, 3, 4]) {
          const m = mean(
            all.filter((o) => o.level === level).map((o) => f(o.text)),
          );
          expect(
            Math.abs(m - overall) / overall,
            `level ${level}: ${m.toFixed(2)} vs ${overall.toFixed(2)}`,
          ).toBeLessThanOrEqual(0.2);
        }
      },
    );

    const levelsWith = (re: RegExp) =>
      new Set(
        allOptions()
          .filter((o) => re.test(o.text))
          .map((o) => o.level),
      );

    it("uses 'paste' or 'by hand' at two or more levels above 0", () => {
      const levels = levelsWith(/\b(past(e|es|ed|ing)|by hand)\b/i);
      expect([...levels].filter((l) => l > 0).length).toBeGreaterThanOrEqual(2);
    });

    it.each([
      ['CI', /\bCI\b/],
      ['hook', /\bhooks?\b/i],
    ] as const)('uses %s at two or more of levels 2-4', (_name, re) => {
      const levels = levelsWith(re);
      expect(
        [2, 3, 4].filter((l) => levels.has(l)).length,
      ).toBeGreaterThanOrEqual(2);
    });

    it("is not solvable by combining length, 'Write' opener and engineering vocabulary (<= chance + 0.12)", () => {
      const { rate, chance } = solverRate(
        (o, i, q) =>
          lengthRank(q, i) +
          (o.text.startsWith('Write') ? 1 : 0) +
          Math.min(count(ENGINEERING, o.text), 3) / 3,
      );
      expect(rate).toBeLessThanOrEqual(chance + 0.12);
    });

    // Rules 29-30 (bank polish): word families, word rarity and situation echo, on the whole bank and each half.
    type BankQ = ReturnType<typeof questions>[number];
    const halves = (): [string, BankQ[]][] => {
      const qs = questions();
      return [
        ['whole bank', qs],
        ['questions 1-32', qs.slice(0, 32)],
        ['questions 33-64', qs.slice(32)],
      ];
    };
    /** Top-level hit rate, chance, and expected chosen vs random level of a solver over `qs`. */
    const solve = (
      qs: BankQ[],
      score: (text: string, q: BankQ) => number,
      mode: Mode,
    ) => {
      let hit = 0;
      let chance = 0;
      let picked = 0;
      let random = 0;
      for (const q of qs) {
        const levels = q.options.map((o) => o.level);
        const top = Math.max(...levels);
        const w = pickWeights(
          q.options.map((o) => score(o.text, q)),
          mode,
        );
        hit += levels.reduce((s, l, i) => s + (l === top ? (w[i] ?? 0) : 0), 0);
        chance += levels.filter((l) => l === top).length / levels.length;
        picked += levels.reduce((s, l, i) => s + (w[i] ?? 0) * l, 0);
        random += mean(levels);
      }
      const n = qs.length;
      return {
        hit: hit / n,
        chance: chance / n,
        picked: picked / n,
        random: random / n,
      };
    };

    /** Rule 29 marker families, fixed a priori by the rule text. */
    const FAMILIES: Record<string, RegExp> = {
      'lazy/docs':
        /\b(manually|by hand|past(e|es|ed|ing)|rerun\w*|let the agent|docs?|documented|examples?|defaults?|templates?)\b/i,
      'rigor adjectives':
        /\b(fixed|strict|single|verified|versioned|central|required|dedicated|signed|pinned)\b/i,
      'compound tokens':
        /(\b\w+-\w+\b|\b[a-z]+[A-Z]\w*\b|\b[A-Z][a-z]+[A-Z]\w*\b|\b[A-Z]{2,}s?\b)/,
    };

    describe.each(Object.keys(FAMILIES))('word family: %s', (family) => {
      const re = FAMILIES[family] as RegExp;
      const marked = (t: string) => (re.test(t) ? 1 : 0);

      it.each(halves().map(([name]) => name))(
        'spreads the family over levels (per-level share within 50% of the overall share) on the %s',
        (name) => {
          const qs = halves().find(([n]) => n === name)?.[1] ?? [];
          const all = qs.flatMap((q) => q.options);
          const overall = mean(all.map((o) => marked(o.text)));
          expect(overall).toBeGreaterThan(0);
          for (const level of [0, 1, 2, 3, 4]) {
            const share = mean(
              all.filter((o) => o.level === level).map((o) => marked(o.text)),
            );
            expect(
              Math.abs(share - overall) / overall,
              `level ${level}: ${share.toFixed(2)} vs ${overall.toFixed(2)}`,
            ).toBeLessThanOrEqual(0.5);
          }
        },
      );

      it.each(halves().map(([name]) => name))(
        'does not raise the chosen level by dropping marked options, or by keeping only them (<= random + 0.20), on the %s',
        (name) => {
          const qs = halves().find(([n]) => n === name)?.[1] ?? [];
          for (const mode of ['dropHighest', 'dropLowest'] as const) {
            const { picked, random } = solve(qs, marked, mode);
            expect(picked, mode).toBeLessThanOrEqual(random + 0.2);
          }
        },
      );
    });

    const words = (t: string) => t.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
    /** Rule 30: mean IDF of an option's words (3+ letters), IDF over all options of the whole bank. */
    const meanIdf = () => {
      const df = new Map<string, number>();
      const all = questions().flatMap((q) => q.options);
      for (const o of all)
        for (const w of new Set(
          words(o.text)
            .filter((x) => x.length >= 3)
            .map((x) => x.toLowerCase()),
        ))
          df.set(w, (df.get(w) ?? 0) + 1);
      return (text: string) => {
        const ws = words(text)
          .filter((x) => x.length >= 3)
          .map((x) => x.toLowerCase());
        return mean(ws.map((w) => Math.log(all.length / (df.get(w) ?? 1))));
      };
    };
    /** Rule 30: share of the option's content words (4+ letters) whose 5-letter stem occurs in the situation. */
    const situationEcho = (text: string, q: BankQ) => {
      const stems = (t: string) =>
        words(t)
          .filter(
            (w) => w.length >= 4 && !FUNCTION_WORDS.has(w.toLowerCase()),
          )
          .map((w) => w.toLowerCase().slice(0, 5));
      const situation = new Set(stems(q.situation));
      const option = stems(text);
      return option.length === 0
        ? 0
        : option.filter((s) => situation.has(s)).length / option.length;
    };

    describe.each(['meanIdf', 'situationEcho'])('solver: %s', (feature) => {
      const score = (): ((t: string, q: BankQ) => number) => {
        if (feature === 'situationEcho') return situationEcho;
        const idf = meanIdf();
        return (t) => idf(t);
      };
      it.each(halves().map(([name]) => name))(
        'stays near chance (<= chance + 0.12) and does not inflate the level (<= random + 0.30) on the %s',
        (name) => {
          const qs = halves().find(([n]) => n === name)?.[1] ?? [];
          const f = score();
          for (const mode of ['max', 'min', 'dropLowest', 'dropHighest'] as const) {
            const { hit, chance, picked, random } = solve(qs, f, mode);
            expect(hit, `${mode} hit`).toBeLessThanOrEqual(chance + 0.12);
            expect(picked, `${mode} level`).toBeLessThanOrEqual(random + 0.3);
          }
        },
      );
    });
  });
});
