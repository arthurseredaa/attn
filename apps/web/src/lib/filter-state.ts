import { filterParams, type PickedFilters } from './filters';
import { buildQueryString } from './query';

export type FilterValues = Pick<PickedFilters, 'skill' | 'q' | 'source' | 'from' | 'to'>;

/**
 * State of the filter bar. `pending` is what the controls show; it changes immediately on every user action (the
 * search text is the raw input, untrimmed). `pushed` are the query strings this bar wrote to the URL that the server
 * props have not caught up with yet, oldest first. `seen` is the query string of the props last synced.
 */
export interface FilterBarState {
  pending: FilterValues;
  pushed: string[];
  seen: string;
}

/** Canonical query string of the filters (the search text is trimmed); this is what goes to the URL. */
export const filterKey = (v: FilterValues): string => buildQueryString(filterParams({ ...v, q: v.q.trim() }));

export const initFilterState = (values: FilterValues): FilterBarState => ({
  pending: values,
  pushed: [],
  seen: filterKey(values),
});

/** Edits the controls without touching the URL (typing, or a debounced control). */
export const edit = (s: FilterBarState, patch: Partial<FilterValues>): FilterBarState => ({
  ...s,
  pending: { ...s.pending, ...patch },
});

/**
 * Writes the pending filters to the URL. Returns the new state and the query string to `router.replace`, or `null`
 * when the URL already has (or is already on its way to) exactly this.
 */
export function commit(s: FilterBarState): { state: FilterBarState; query: string | null } {
  const key = filterKey(s.pending);
  const last = s.pushed.length > 0 ? s.pushed[s.pushed.length - 1]! : s.seen;
  if (key === last) return { state: s, query: null };
  return { state: { ...s, pushed: [...s.pushed, key] }, query: key };
}

/** Edits and commits at once (a checkbox, chip or select). Built from `pending`, never from server props. */
export const change = (s: FilterBarState, patch: Partial<FilterValues>) => commit(edit(s, patch));

/** Clears every filter, including a search text that has not reached the URL yet. */
export const clear = (s: FilterBarState) =>
  commit(edit(s, { skill: [], q: '', source: undefined, from: undefined, to: undefined }));

/**
 * Server props arrived. If they show something this bar wrote itself, keep `pending` (the user may have typed or
 * clicked since) and forget the pushes up to it. Anything else (back/forward, a link) is an outside change: show it.
 */
export function syncProps(s: FilterBarState, values: FilterValues): FilterBarState {
  const key = filterKey(values);
  if (key === s.seen) return s;
  const i = s.pushed.indexOf(key);
  if (i !== -1) return { ...s, pushed: s.pushed.slice(i + 1), seen: key };
  return { pending: values, pushed: [], seen: key };
}
