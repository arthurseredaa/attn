import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir, loadQuiz, loadTaxonomy } from "./data";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "attn-quiz-"));
  fs.mkdirSync(path.join(dir, "quiz"));
  const levels = [0, 1, 2, 3, 4]
    .map((l) => `  - {level: ${l}, label: L${l}, description: d}`)
    .join("\n");
  const skills = ["a", "b"]
    .map(
      (id) => `      - {id: ${id}, name: ${id}, description: x, roles: [dev]}`,
    )
    .join("\n");
  fs.writeFileSync(
    path.join(dir, "taxonomy.yml"),
    `version: 1\nlevels:\n${levels}\ndomains:\n  - id: d\n    name: D\n    skills:\n${skills}\n`,
  );
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const question = (id: string, skill: string, levels: number[]) =>
  `  - id: ${id}\n    skill_id: ${skill}\n    situation: s\n    options:\n` +
  levels
    .map((l, i) => `      - {text: "${id} opt ${i}", level: ${l}}`)
    .join("\n") +
  "\n";
const writeQuiz = (body: string) =>
  fs.writeFileSync(path.join(dir, "quiz/dev.yml"), body);

describe("loadQuiz", () => {
  it("returns the parsed bank", () => {
    writeQuiz(
      `version: 3\nquestions:\n${question("a-1", "a", [2, 0, 4, 1])}${question("a-2", "a", [3, 1, 0, 4])}`,
    );
    const quiz = loadQuiz("dev", dir);
    expect(quiz.version).toBe(3);
    expect(quiz.questions.map((x) => x.id)).toEqual(["a-1", "a-2"]);
  });

  it("names the file and the issue for an unknown skill", () => {
    writeQuiz(
      `version: 1\nquestions:\n${question("z-1", "z", [2, 0, 4, 1])}${question("z-2", "z", [3, 1, 0, 4])}`,
    );
    expect(() => loadQuiz("dev", dir)).toThrow(/quiz\/dev\.yml/);
    expect(() => loadQuiz("dev", dir)).toThrow(/unknown skill_id z/);
  });

  it("names the file for malformed YAML or a missing version", () => {
    writeQuiz("version: [\n");
    expect(() => loadQuiz("dev", dir)).toThrow(/quiz\/dev\.yml/);
    writeQuiz(`questions:\n${question("a-1", "a", [2, 0, 4, 1])}`);
    expect(() => loadQuiz("dev", dir)).toThrow(/quiz\/dev\.yml/);
  });

  it("throws ENOENT when the role file is missing", () => {
    expect(() => loadQuiz("nope", dir)).toThrow(/ENOENT|no such file/i);
  });
});

const DRAFT_HEADER = [
  "# DRAFT quiz bank: drafted by Claude (2026-10-14), NOT reviewed by the project owner.",
  "# The owner must review every question and every option level before this bank is trusted:",
  "# check that the situation is realistic, that each option's hidden level (0-4, the shared level scale)",
  "# matches what the option shows about the person, and that wrong-sounding options are not obviously wrong.",
  "# Once reviewed, remove this header. Levels are hidden: they never leave the server.",
];
const PART_1 = [
  "context-engineering",
  "cc-skills-commands",
  "cc-hooks",
  "cc-subagents",
  "cc-plugins",
  "cc-mcp-usage",
  "cc-headless-ci",
  "parallel-agents",
  "spec-driven-workflow",
  "agent-verification",
  "tool-use-loop",
  "agent-sdk",
  "mcp-server-build",
  "multi-agent-orchestration",
  "human-in-the-loop",
  "workflow-automation",
];

describe("real quiz bank", () => {
  it("loads without schema or bank issues", () => {
    expect(() => loadQuiz()).not.toThrow();
  });

  it("keeps the DRAFT header verbatim while it is present", () => {
    const lines = fs
      .readFileSync(path.join(dataDir(), "quiz/dev.yml"), "utf8")
      .split("\n");
    if (lines[0]?.startsWith("# DRAFT"))
      expect(lines.slice(0, 5)).toEqual(DRAFT_HEADER);
  });

  it("has each part-1 skill exactly twice, in taxonomy order", () => {
    const ids = loadQuiz().questions.map((q) => q.id);
    const order = loadTaxonomy().domains.flatMap((d) =>
      d.skills.map((s) => s.id),
    );
    const part1 = PART_1.slice().sort(
      (a, b) => order.indexOf(a) - order.indexOf(b),
    );
    expect(PART_1).toEqual(part1);
    const expected = PART_1.flatMap((s) => [`${s}-1`, `${s}-2`]);
    expect(ids.filter((id) => expected.includes(id))).toEqual(expected);
    expect(ids.slice(0, expected.length)).toEqual(expected);
  });

  it("uses every level 0-4 across the part-1 bank", () => {
    const levels = new Set(
      loadQuiz()
        .questions.filter((q) => PART_1.includes(q.skill_id))
        .flatMap((q) => q.options.map((o) => o.level)),
    );
    expect([...levels].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps texts short enough for the UI", () => {
    for (const q of loadQuiz().questions) {
      expect(q.situation.length, q.id).toBeLessThanOrEqual(500);
      for (const o of q.options)
        expect(o.text.length, `${q.id}: ${o.text}`).toBeLessThanOrEqual(280);
    }
  });

  describe("length and wording guards", () => {
    const questions = () => loadQuiz().questions;
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

    it("does not make the longest option the top level in more than 35% of questions", () => {
      const qs = questions();
      const hits = qs.filter((q) => {
        const lengths = q.options.map((o) => o.text.length);
        const top = Math.max(...q.options.map((o) => o.level));
        return q.options[lengths.indexOf(Math.max(...lengths))]?.level === top;
      });
      expect(hits.length / qs.length).toBeLessThanOrEqual(0.35);
    });

    it("keeps option length uncorrelated with level (mean Pearson r within +-0.3)", () => {
      const rs = questions().map((q) =>
        pearson(
          q.options.map((o) => o.text.length),
          q.options.map((o) => o.level),
        ),
      );
      expect(Math.abs(mean(rs))).toBeLessThanOrEqual(0.3);
    });

    it("keeps the mean option length of every level within 10% of the overall mean", () => {
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

    it("keeps options within 15% of their question mean length", () => {
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

    const FIRST_PERSON = /\b(I|my|me|myself)\b/i;
    const JUSTIFICATION = /\b(since|because|so I|so that)\b/i;
    const JARGON = /\b(script|CI|hook|hooks)\b/;
    const allOptions = () => questions().flatMap((q) => q.options);
    const share = (opts: { text: string }[], re: RegExp) =>
      opts.filter((o) => re.test(o.text)).length / opts.length;
    const lengthRank = (q: { options: { text: string }[] }, i: number) => {
      const lengths = q.options.map((o) => o.text.length);
      return (
        lengths.filter((l) => l < (lengths[i] ?? 0)).length /
        (lengths.length - 1)
      );
    };

    it("does not make the shortest option the top level in more than 35% of questions", () => {
      const qs = questions();
      const hits = qs.filter((q) => {
        const lengths = q.options.map((o) => o.text.length);
        const top = Math.max(...q.options.map((o) => o.level));
        return q.options[lengths.indexOf(Math.min(...lengths))]?.level === top;
      });
      expect(hits.length / qs.length).toBeLessThanOrEqual(0.35);
    });

    it("keeps the mean length rank of the top option near the middle (0.5 +- 0.15)", () => {
      const ranks = questions().map((q) => {
        const top = Math.max(...q.options.map((o) => o.level));
        return lengthRank(
          q,
          q.options.findIndex((o) => o.level === top),
        );
      });
      expect(Math.abs(mean(ranks) - 0.5)).toBeLessThanOrEqual(0.15);
    });

    it("spreads first person evenly over levels (+-15 points of the overall share)", () => {
      const all = allOptions();
      const overall = share(all, FIRST_PERSON);
      for (const level of [0, 1, 2, 3, 4]) {
        const s = share(
          all.filter((o) => o.level === level),
          FIRST_PERSON,
        );
        expect(Math.abs(s - overall), `level ${level}`).toBeLessThanOrEqual(
          0.15,
        );
      }
    });

    it("keeps justification clauses rare (<= 25% at level 0, <= 10% elsewhere)", () => {
      const all = allOptions();
      for (const level of [0, 1, 2, 3, 4]) {
        const s = share(
          all.filter((o) => o.level === level),
          JUSTIFICATION,
        );
        expect(s, `level ${level}`).toBeLessThanOrEqual(
          level === 0 ? 0.25 : 0.1,
        );
      }
    });

    it("does not let one opening word dominate a level (<= 40%)", () => {
      const all = allOptions();
      for (const level of [0, 1, 2, 3, 4]) {
        const opts = all.filter((o) => o.level === level);
        const counts = new Map<string, number>();
        for (const o of opts) {
          const word = o.text.split(" ")[0] ?? "";
          counts.set(word, (counts.get(word) ?? 0) + 1);
        }
        expect(
          Math.max(...counts.values()) / opts.length,
          `level ${level}`,
        ).toBeLessThanOrEqual(0.4);
      }
    });

    it('keeps script/CI/hook vocabulary off a single level and "by hand"/"paste" off level 0 only', () => {
      const all = allOptions();
      expect(
        share(
          all.filter((o) => o.level === 4),
          JARGON,
        ),
      ).toBeLessThanOrEqual(0.4);
      const manual = /by hand|paste/i;
      expect(
        all.filter((o) => o.level > 0 && manual.test(o.text)).length,
      ).toBeGreaterThan(0);
    });

    it("is not solvable by a naive surface-cue solver (picks the top level in <= 40%)", () => {
      const qs = questions();
      const hits = qs.filter((q) => {
        const scores = q.options.map(
          (o, i) =>
            lengthRank(q, i) +
            (FIRST_PERSON.test(o.text) ? 0 : 1) +
            (o.text.startsWith("Write") ? 1 : 0) +
            (JARGON.test(o.text) ? 1 : 0),
        );
        const best = q.options[scores.indexOf(Math.max(...scores))];
        return best?.level === Math.max(...q.options.map((o) => o.level));
      });
      expect(hits.length / qs.length).toBeLessThanOrEqual(0.4);
    });

    it('uses no hedge words and few "I have not" openers', () => {
      const texts = questions().flatMap((q) => q.options.map((o) => o.text));
      expect(
        texts.filter((t) => /\b(hope|somehow|simply|whatever)\b/i.test(t)),
      ).toEqual([]);
      expect(
        texts.filter((t) => /\bI (have not|haven't)\b/i.test(t)).length,
      ).toBeLessThanOrEqual(2);
    });
  });
});
