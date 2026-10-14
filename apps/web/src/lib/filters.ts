export type RawSearchParams = Record<string, string | string[] | undefined>;
export const FILTER_KEYS = ['source', 'skill', 'from', 'to'] as const;

export interface PickedFilters {
  source?: string;
  skill?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

export function pickFilters(sp: RawSearchParams): PickedFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const out: PickedFilters = {};
  for (const k of [...FILTER_KEYS, 'cursor'] as const) {
    const v = first(sp[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
