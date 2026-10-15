import type { LabelOutput } from '@attn/shared';
import { FatalLabelerError } from './errors';
import type { LabelResult, LabelTokenUsage, Labeler, PublicArticle } from './types';

export const MAX_SECONDARY_SKILLS = 3;

export interface ParsedLabelModel {
  main: string;
  /** Present only for a `<main>+<secondary>` combo. */
  secondary?: string;
}

/** Splits `<main>` or `<main>+<secondary>`; an empty part or a second `+` throws FatalLabelerError. */
export function parseLabelModel(model: string): ParsedLabelModel {
  if (!model.includes('+')) return { main: model };
  const parts = model.split('+');
  if (parts.length > 2) {
    throw new FatalLabelerError(`invalid LABEL_MODEL "${model}": use at most one "+" (<main>+<secondary>)`);
  }
  const [main, secondary] = parts.map((p) => p.trim()) as [string, string];
  if (!main || !secondary) {
    throw new FatalLabelerError(`invalid LABEL_MODEL "${model}": both sides of "+" must be model ids`);
  }
  return { main, secondary };
}

/** Main's label with its secondary skills replaced by the secondary labeler's: minus main's primary, deduped, at most 3, order kept. */
export function mergeSecondarySkills<T extends LabelOutput>(main: T, secondarySkills: readonly string[]): T {
  const seen = new Set<string>([main.primary_skill]);
  const merged: string[] = [];
  for (const s of secondarySkills) {
    if (seen.has(s)) continue;
    seen.add(s);
    merged.push(s);
    if (merged.length === MAX_SECONDARY_SKILLS) break;
  }
  return { ...main, secondary_skills: merged };
}

function sum(a: LabelTokenUsage, b: LabelTokenUsage): LabelTokenUsage {
  const total: LabelTokenUsage = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
  for (const k of ['cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (a[k] !== undefined || b[k] !== undefined) total[k] = (a[k] ?? 0) + (b[k] ?? 0);
  }
  return total;
}

const ZERO: LabelTokenUsage = { inputTokens: 0, outputTokens: 0 };

export interface ComboLabelerOptions {
  /** The stored model name: the full combo string. */
  model: string;
  main: Labeler;
  secondary: Labeler;
  /** Called once per secondary failure that fell back to main's own secondary skills. */
  onSecondaryFallback: (reason: string) => void;
}

function shortReason(e: unknown): string {
  const name = e instanceof Error ? e.name : 'Error';
  const msg = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').trim();
  return `${name}: ${msg.length > 160 ? `${msg.slice(0, 160)}...` : msg}`;
}

/**
 * Calls both labelers in parallel. The label is main's, with secondary skills from the secondary labeler. Any
 * secondary failure keeps main's own secondary skills; main's relevance verdict (if any) is kept unchanged and the secondary's is ignored; a main failure is thrown as is (so fatal, 429 and overload
 * handling stay exactly the main labeler's).
 */
export function createComboLabeler(opts: ComboLabelerOptions): Labeler {
  const { main, secondary } = opts;
  return {
    model: opts.model,
    async label(article: PublicArticle): Promise<LabelResult> {
      const [m, s] = await Promise.allSettled([main.label(article), secondary.label(article)]);
      if (m.status === 'rejected') throw m.reason;
      if (s.status === 'rejected') {
        opts.onSecondaryFallback(shortReason(s.reason));
        return m.value;
      }
      return mergeSecondarySkills(m.value, s.value.secondary_skills);
    },
    usage() {
      return sum(main.usage?.() ?? ZERO, secondary.usage?.() ?? ZERO);
    },
    usageByModel() {
      const out: Record<string, LabelTokenUsage> = {};
      for (const l of [main, secondary]) {
        if (!l.usage) continue;
        const prev = out[l.model];
        out[l.model] = prev ? sum(prev, l.usage()) : l.usage();
      }
      return out;
    },
  };
}
