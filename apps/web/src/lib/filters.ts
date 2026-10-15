import { MAX_FILTER_SKILLS, MAX_SEARCH_LENGTH } from '@attn/shared';

export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * Everything the For you and All pages keep in the URL. `skill` repeats (`?skill=a&skill=b`, any-match); `q` is the
 * title search. `source`, `from`, `to` and `cursor` are used by All only.
 */
export interface PickedFilters {
  skill: string[];
  q: string;
  source?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

const list = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const first = (v: string | string[] | undefined): string | undefined => list(v)[0] || undefined;

/** URL query -> filters. Lenient: blank values are dropped, `skill` is de-duplicated and capped like the api caps it. */
export function pickFilters(sp: RawSearchParams): PickedFilters {
  const out: PickedFilters = {
    skill: [...new Set(list(sp.skill).filter((s) => s !== ''))].slice(0, MAX_FILTER_SKILLS),
    q: (first(sp.q) ?? '').trim().slice(0, MAX_SEARCH_LENGTH),
  };
  for (const k of ['source', 'from', 'to', 'cursor'] as const) {
    const v = first(sp[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Filters -> query params for `buildQueryString` (empty values are left out there). Paging is not included. */
export function filterParams(f: Pick<PickedFilters, 'skill' | 'q' | 'source' | 'from' | 'to'>) {
  return { skill: f.skill, q: f.q || undefined, source: f.source, from: f.from, to: f.to };
}

/** True when any filter that narrows the list is set. */
export function hasActiveFilters(f: Pick<PickedFilters, 'skill' | 'q' | 'source' | 'from' | 'to'>): boolean {
  return f.skill.length > 0 || f.q !== '' || Boolean(f.source || f.from || f.to);
}

/** Adds the skill, or removes it when already selected. Selecting past the cap is ignored. */
export function toggleSkill(skills: readonly string[], id: string): string[] {
  if (skills.includes(id)) return skills.filter((s) => s !== id);
  return skills.length >= MAX_FILTER_SKILLS ? [...skills] : [...skills, id];
}
