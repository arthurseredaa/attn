import type { GoldenItem, LabelOutput } from '@attn/shared';
import type { LabelTokenUsage } from '../label';

export type EvalField = 'primary_skill' | 'secondary_skills' | 'difficulty' | 'type' | 'quality';
export interface Disagreement {
  url: string;
  field: EvalField;
  expected: string;
  actual: string;
}
export interface ItemScore {
  primary: boolean;
  secondaryJaccard: number;
  difficultyExact: boolean;
  difficultyWithin1: boolean;
  typeExact: boolean;
  qualityWithin1: boolean;
}
export interface EvalMetrics {
  primary_skill: number;
  secondary_skills: number;
  difficulty_exact: number;
  difficulty_within1: number;
  type: number;
  quality_within1: number;
}
export interface EvalFailure {
  url: string;
  error: string;
}
export interface EvalReport {
  model: string;
  total: number;
  evaluated: number;
  failures: EvalFailure[];
  rateLimited: boolean;
  fatal?: string;
  metrics: EvalMetrics | null;
  disagreements: Disagreement[];
  /** Provider token totals for the run, when the labeler reports them. */
  usage?: LabelTokenUsage;
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export function scoreItem(expected: GoldenItem, actual: LabelOutput): ItemScore {
  const dd = Math.abs(expected.difficulty - actual.difficulty);
  return {
    primary: expected.primary_skill === actual.primary_skill,
    secondaryJaccard: jaccard(expected.secondary_skills, actual.secondary_skills),
    difficultyExact: dd === 0,
    difficultyWithin1: dd <= 1,
    typeExact: expected.type === actual.type,
    qualityWithin1: Math.abs(expected.quality - actual.quality) <= 1,
  };
}

const list = (xs: readonly string[]) => (xs.length === 0 ? '-' : xs.join(','));

export function findDisagreements(url: string, expected: GoldenItem, actual: LabelOutput): Disagreement[] {
  const s = scoreItem(expected, actual);
  const out: Disagreement[] = [];
  const add = (field: EvalField, e: string, a: string) => out.push({ url, field, expected: e, actual: a });
  if (!s.primary) add('primary_skill', expected.primary_skill, actual.primary_skill);
  if (s.secondaryJaccard < 1) add('secondary_skills', list(expected.secondary_skills), list(actual.secondary_skills));
  if (!s.difficultyExact) add('difficulty', String(expected.difficulty), String(actual.difficulty));
  if (!s.typeExact) add('type', expected.type, actual.type);
  if (!s.qualityWithin1) add('quality', String(expected.quality), String(actual.quality));
  return out;
}

export function buildReport(args: {
  model: string;
  total: number;
  scored: { url: string; expected: GoldenItem; actual: LabelOutput }[];
  failures: EvalFailure[];
  rateLimited: boolean;
  fatal?: string;
  usage?: LabelTokenUsage;
}): EvalReport {
  const { scored } = args;
  const scores = scored.map((s) => scoreItem(s.expected, s.actual));
  const mean = (f: (s: ItemScore) => number) => scores.reduce((sum, s) => sum + f(s), 0) / scores.length;
  const metrics: EvalMetrics | null =
    scores.length === 0
      ? null
      : {
          primary_skill: mean((s) => Number(s.primary)),
          secondary_skills: mean((s) => s.secondaryJaccard),
          difficulty_exact: mean((s) => Number(s.difficultyExact)),
          difficulty_within1: mean((s) => Number(s.difficultyWithin1)),
          type: mean((s) => Number(s.typeExact)),
          quality_within1: mean((s) => Number(s.qualityWithin1)),
        };
  return {
    model: args.model,
    total: args.total,
    evaluated: scored.length,
    failures: args.failures,
    rateLimited: args.rateLimited,
    ...(args.fatal !== undefined ? { fatal: args.fatal } : {}),
    metrics,
    disagreements: scored.flatMap((s) => findDisagreements(s.url, s.expected, s.actual)),
    ...(args.usage !== undefined ? { usage: args.usage } : {}),
  };
}

/** `tokens: input=<n> output=<n>[ cache_read=<n>][ cache_write=<n>]`; input counts cached tokens too. */
export function formatUsage(u: LabelTokenUsage): string {
  const parts = [`input=${u.inputTokens}`, `output=${u.outputTokens}`];
  if (u.cacheReadTokens !== undefined) parts.push(`cache_read=${u.cacheReadTokens}`);
  if (u.cacheWriteTokens !== undefined) parts.push(`cache_write=${u.cacheWriteTokens}`);
  return `tokens: ${parts.join(' ')}`;
}

export function formatEvalReport(report: EvalReport): string {
  const lines = [
    `model: ${report.model}`,
    `articles: evaluated=${report.evaluated} of ${report.total} failed=${report.failures.length}`,
  ];
  if (report.metrics === null) {
    lines.push('no articles evaluated');
  } else {
    for (const [name, value] of Object.entries(report.metrics)) {
      lines.push(name.padEnd(20) + (value * 100).toFixed(1) + '%');
    }
  }
  if (report.disagreements.length > 0) {
    lines.push('disagreements:');
    const urls = [...new Set(report.disagreements.map((d) => d.url))];
    for (const url of urls) {
      lines.push(`  ${url}`);
      for (const d of report.disagreements.filter((x) => x.url === url)) {
        lines.push(`    ${d.field}: expected=${d.expected} actual=${d.actual}`);
      }
    }
  }
  if (report.failures.length > 0) {
    lines.push('failed:');
    for (const f of report.failures) lines.push(`  ${f.url}  ${f.error}`);
  }
  if (report.rateLimited) lines.push('rate limited: evaluation stopped early');
  if (report.fatal) lines.push(`provider error: ${report.fatal}; evaluation stopped early`);
  if (report.usage) lines.push(formatUsage(report.usage));
  return lines.join('\n');
}
