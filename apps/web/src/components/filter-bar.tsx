'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { MAX_FILTER_SKILLS, MAX_SEARCH_LENGTH, type SourceSummary, type Taxonomy } from '@attn/shared';
import { change, clear, commit, edit, initFilterState, syncProps, type FilterBarState, type FilterValues } from '@/lib/filter-state';
import { hasActiveFilters, toggleSkill } from '@/lib/filters';

const DEBOUNCE_MS = 300;
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const control = `w-full rounded-lg border border-line bg-card px-3 py-2 text-sm ${focusRing}`;

/**
 * Filters shared by For you and All, kept in the URL: skills (multi-select, any-match), title search, and on All also
 * source and dates. Every change does `router.replace` (no history entries) without `cursor`, so paging restarts, and
 * the server page re-fetches. Reloading restores the filters from the URL.
 */
export function FilterBar({
  taxonomy,
  values,
  sources,
}: {
  taxonomy: Taxonomy;
  values: FilterValues;
  /** All only: adds the source and date controls. */
  sources?: SourceSummary[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState(() => initFilterState(values));
  const stateRef = useRef(state);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const names = new Map(taxonomy.domains.flatMap((d) => d.skills.map((s) => [s.id, s.name] as const)));

  // Server props caught up with this bar's own writes (keep what the user did meanwhile) or the URL changed from
  // outside (back/forward, a link): then show it.
  const synced = syncProps(state, values);
  if (synced !== state) setState(synced);
  useEffect(() => {
    stateRef.current = state;
  });
  useEffect(() => () => cancelTimer(), []);

  function cancelTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function push(next: { state: FilterBarState; query: string | null }) {
    stateRef.current = next.state;
    setState(next.state);
    if (next.query !== null) router.replace(`${pathname}${next.query}`, { scroll: false });
  }

  /** Applies at once (checkbox, chip, select). */
  function applyNow(patch: Partial<FilterValues>) {
    cancelTimer(); // the commit carries any unsent search text too
    push(change(stateRef.current, patch));
  }

  /** Updates the control now and the URL after a pause in typing (search text, dates). */
  function applyLater(patch: Partial<FilterValues>) {
    const next = edit(stateRef.current, patch);
    stateRef.current = next;
    setState(next);
    cancelTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      push(commit(stateRef.current));
    }, DEBOUNCE_MS);
  }

  function clearAll() {
    cancelTimer();
    push(clear(stateRef.current));
  }

  const v = state.pending;
  const active = hasActiveFilters({ ...v, q: v.q.trim() });

  return (
    <div className="space-y-3" role="search" aria-label="Filter articles">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted">Search titles</span>
          <input
            type="search"
            value={v.q}
            maxLength={MAX_SEARCH_LENGTH}
            onChange={(e) => applyLater({ q: e.target.value })}
            placeholder="Search titles"
            className={control}
          />
        </label>
        <details
          ref={detailsRef}
          className="group relative text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && detailsRef.current?.open) {
              detailsRef.current.open = false;
              summaryRef.current?.focus();
            }
          }}
        >
          <summary ref={summaryRef} className={`flex cursor-pointer list-none flex-col gap-1 rounded-lg ${focusRing}`}>
            <span className="text-muted">Skills</span>
            <span className="rounded-lg border border-line bg-card px-3 py-2">
              {v.skill.length === 0 ? 'All skills' : `${v.skill.length} selected`}
            </span>
          </summary>
          <div className="mt-1 max-h-80 space-y-3 overflow-y-auto rounded-lg border border-line bg-card p-3 shadow-sm sm:absolute sm:inset-x-0 sm:z-10">
            {taxonomy.domains.map((d) => (
              <fieldset key={d.id}>
                <legend className="mb-1 font-medium">{d.name}</legend>
                <ul className="space-y-1">
                  {d.skills.map((s) => {
                    const checked = v.skill.includes(s.id);
                    return (
                      <li key={s.id}>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!checked && v.skill.length >= MAX_FILTER_SKILLS}
                            onChange={() => applyNow({ skill: toggleSkill(v.skill, s.id) })}
                            className={focusRing}
                          />
                          <span>{s.name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ))}
            <p className="text-xs text-muted">Up to {MAX_FILTER_SKILLS} skills; an article matches if it has any of them.</p>
          </div>
        </details>
      </div>

      {sources ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Source</span>
            <select
              value={v.source ?? ''}
              onChange={(e) => applyNow({ source: e.target.value || undefined })}
              className={control}
            >
              <option value="">All sources</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">From</span>
            <input
              type="date"
              value={v.from ?? ''}
              onChange={(e) => applyLater({ from: e.target.value || undefined })}
              className={control}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">To</span>
            <input
              type="date"
              value={v.to ?? ''}
              onChange={(e) => applyLater({ to: e.target.value || undefined })}
              className={control}
            />
          </label>
        </div>
      ) : null}

      {v.skill.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Selected skills">
          {v.skill.map((id) => {
            const name = names.get(id) ?? id;
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-label={`Remove skill filter: ${name}`}
                  onClick={() => applyNow({ skill: v.skill.filter((s) => s !== id) })}
                  className={`rounded-full bg-accent-soft px-2.5 py-0.5 text-xs hover:underline ${focusRing}`}
                >
                  {name} <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {active ? (
        <button
          type="button"
          onClick={clearAll}
          className={`text-sm text-muted hover:text-fg ${focusRing}`}
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
