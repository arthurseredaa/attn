import Link from 'next/link';
import type { SourceSummary, Taxonomy } from '@attn/shared';

interface Values {
  source?: string;
  skill?: string;
  from?: string;
  to?: string;
}

const control = 'w-full rounded-lg border border-line bg-card px-3 py-2 text-sm';

// No cursor field: changing filters restarts at the newest article.
export function FiltersForm({
  sources,
  taxonomy,
  values,
}: {
  sources: SourceSummary[];
  taxonomy: Taxonomy;
  values: Values;
}) {
  return (
    <form method="get" action="/all" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="grid gap-1 text-sm">
          <span className="text-muted">Source</span>
          <select name="source" defaultValue={values.source ?? ''} className={control}>
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted">Skill</span>
          <select name="skill" defaultValue={values.skill ?? ''} className={control}>
            <option value="">All skills</option>
            {taxonomy.domains.map((d) => (
              <optgroup key={d.id} label={d.name}>
                {d.skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted">From</span>
          <input type="date" name="from" defaultValue={values.from ?? ''} className={control} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted">To</span>
          <input type="date" name="to" defaultValue={values.to ?? ''} className={control} />
        </label>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <button type="submit" className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-fg">
          Apply
        </button>
        <Link href="/all" className="text-muted hover:text-fg">
          Reset
        </Link>
      </div>
    </form>
  );
}
