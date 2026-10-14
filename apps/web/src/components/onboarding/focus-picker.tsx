'use client';

import { MAX_FOCUS, type Taxonomy } from '@attn/shared';
import { toggleSkill } from '@/lib/reorder';
import { SortableList } from './sortable-list';

export function FocusPicker({
  taxonomy,
  role,
  value,
  onChange,
}: {
  taxonomy: Taxonomy;
  role: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const names: Record<string, string> = {};
  for (const d of taxonomy.domains) for (const s of d.skills) names[s.id] = s.name;
  const full = value.length >= MAX_FOCUS;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">Pick 1 to 5 skills, then drag to order them. The first one matters most.</p>
      {taxonomy.domains.map((d) => {
        const skills = d.skills.filter((s) => s.roles.includes(role));
        if (skills.length === 0) return null;
        return (
          <section key={d.id} className="space-y-2">
            <h2 className="text-sm font-semibold">{d.name}</h2>
            <div className="flex flex-wrap gap-2">
              {skills.map((s) => {
                const on = value.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    disabled={!on && full}
                    title={s.description}
                    onClick={() => onChange(toggleSkill(value, s.id, MAX_FOCUS))}
                    className={`rounded-full border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                      on ? 'border-transparent bg-accent text-accent-fg' : 'border-line bg-card hover:bg-accent-soft'
                    }`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Your focus, in priority order</h2>
        {value.length === 0 ? (
          <p className="text-sm text-muted">Nothing picked yet.</p>
        ) : (
          <SortableList
            items={value}
            labels={names}
            renderLabel={(id) => names[id] ?? id}
            onChange={onChange}
          />
        )}
      </section>
    </div>
  );
}
