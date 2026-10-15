'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MAX_FOCUS, profileSchema, type FocusEntry } from '@attn/shared';
import { BrowserApiError, browserJson } from '@/lib/browser-api';
import { toggleSkill } from '@/lib/reorder';
import { SortableList } from '@/components/onboarding/sortable-list';

export function FocusEditor({
  focus,
  skills,
  names,
}: {
  focus: FocusEntry[];
  skills: { id: string; name: string; domain: string }[];
  /** skill id -> name (skillNameMap). */
  names: Record<string, string>;
}) {
  const router = useRouter();
  const server = focus.map((f) => f.skillId);
  const [value, setValue] = useState<string[]>(server);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = value.length !== server.length || value.some((id, i) => id !== server[i]);
  const valid = value.length >= 1 && value.length <= MAX_FOCUS;
  const full = value.length >= MAX_FOCUS;
  const domains = [...new Set(skills.map((s) => s.domain))];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await browserJson('PUT', '/focus', profileSchema, { focus: value });
      router.refresh();
    } catch (e) {
      setError(e instanceof BrowserApiError ? e.message : 'Could not save your focus.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Focus</h2>
      <SortableList
        items={value}
        labels={names}
        renderLabel={(id) => names[id] ?? id}
        onChange={setValue}
        emptyText="Pick at least one focus skill."
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="add-focus-skill">
          Add a skill
        </label>
        <select
          id="add-focus-skill"
          value=""
          disabled={full}
          onChange={(e) => {
            if (e.target.value) setValue(toggleSkill(value, e.target.value, MAX_FOCUS));
          }}
          className="rounded-md border border-border bg-card px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          <option value="">Add a skill…</option>
          {domains.map((d) => (
            <optgroup key={d} label={d}>
              {skills
                .filter((s) => s.domain === d && !value.includes(s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={!changed || !valid || saving}
          className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save focus'}
        </button>
        <button
          type="button"
          onClick={() => {
            setValue(server);
            setError(null);
          }}
          disabled={!changed || saving}
          className="rounded-md border border-border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reset
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
