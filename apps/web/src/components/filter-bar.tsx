'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { MAX_FILTER_SKILLS, MAX_SEARCH_LENGTH, type SourceSummary, type Taxonomy } from '@attn/shared';
import { filterParams, hasActiveFilters, toggleSkill, type PickedFilters } from '@/lib/filters';
import { buildQueryString } from '@/lib/query';

type Values = Pick<PickedFilters, 'skill' | 'q' | 'source' | 'from' | 'to'>;

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
  values: Values;
  /** All only: adds the source and date controls. */
  sources?: SourceSummary[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(values.q);
  const [prevUrlQ, setPrevUrlQ] = useState(values.q);
  const latest = useRef(values);
  latest.current = values;
  const names = new Map(taxonomy.domains.flatMap((d) => d.skills.map((s) => [s.id, s.name] as const)));

  // The URL changed from outside the box (Clear filters, back/forward): show it.
  if (values.q !== prevUrlQ) {
    setPrevUrlQ(values.q);
    if (values.q !== q.trim()) setQ(values.q);
  }

  function apply(change: Partial<Values>) {
    const next = { ...latest.current, ...change };
    router.replace(`${pathname}${buildQueryString(filterParams(next))}`, { scroll: false });
  }
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // Debounced search: wait for a pause in typing before touching the URL.
  useEffect(() => {
    if (q.trim() === latest.current.q) return;
    const t = setTimeout(() => applyRef.current({ q: q.trim() }), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  const active = hasActiveFilters(values) || q.trim() !== '';

  return (
    <div className="space-y-3" role="search" aria-label="Filter articles">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted">Search titles</span>
          <input
            type="search"
            value={q}
            maxLength={MAX_SEARCH_LENGTH}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search titles"
            className={control}
          />
        </label>
        <details className="group relative text-sm">
          <summary className={`flex cursor-pointer list-none flex-col gap-1 rounded-lg ${focusRing}`}>
            <span className="text-muted">Skills</span>
            <span className="rounded-lg border border-line bg-card px-3 py-2">
              {values.skill.length === 0 ? 'All skills' : `${values.skill.length} selected`}
            </span>
          </summary>
          <div className="mt-1 max-h-80 space-y-3 overflow-y-auto rounded-lg border border-line bg-card p-3 shadow-sm sm:absolute sm:inset-x-0 sm:z-10">
            {taxonomy.domains.map((d) => (
              <fieldset key={d.id}>
                <legend className="mb-1 font-medium">{d.name}</legend>
                <ul className="space-y-1">
                  {d.skills.map((s) => {
                    const checked = values.skill.includes(s.id);
                    return (
                      <li key={s.id}>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!checked && values.skill.length >= MAX_FILTER_SKILLS}
                            onChange={() => apply({ skill: toggleSkill(values.skill, s.id) })}
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
              value={values.source ?? ''}
              onChange={(e) => apply({ source: e.target.value || undefined })}
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
              value={values.from ?? ''}
              onChange={(e) => apply({ from: e.target.value || undefined })}
              className={control}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">To</span>
            <input
              type="date"
              value={values.to ?? ''}
              onChange={(e) => apply({ to: e.target.value || undefined })}
              className={control}
            />
          </label>
        </div>
      ) : null}

      {values.skill.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Selected skills">
          {values.skill.map((id) => {
            const name = names.get(id) ?? id;
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-label={`Remove skill filter: ${name}`}
                  onClick={() => apply({ skill: values.skill.filter((s) => s !== id) })}
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
          onClick={() => {
            setQ('');
            router.replace(pathname, { scroll: false });
          }}
          className={`text-sm text-muted hover:text-fg ${focusRing}`}
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
