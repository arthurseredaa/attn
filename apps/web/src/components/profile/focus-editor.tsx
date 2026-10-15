'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MAX_FOCUS, profileSchema, type FocusEntry } from '@attn/shared';
import { BrowserApiError, browserJson } from '@/lib/browser-api';
import { toggleSkill } from '@/lib/reorder';
import { SortableList } from '@/components/onboarding/sortable-list';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';

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
    <section aria-labelledby="focus-editor-heading" className="max-w-2xl space-y-3">
      <h2 id="focus-editor-heading" className="text-lg font-semibold tracking-[-0.01em]">
        Focus skills
      </h2>
      <SortableList
        items={value}
        labels={names}
        renderLabel={(id) => names[id] ?? id}
        onChange={setValue}
        emptyText="Pick at least one focus skill."
      />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <label className="sr-only" htmlFor="add-focus-skill">
          Add a skill
        </label>
        <Select
          value=""
          disabled={full}
          onValueChange={(id) => {
            if (id) setValue(toggleSkill(value, id, MAX_FOCUS));
          }}
        >
          <SelectTrigger id="add-focus-skill" className="w-full sm:w-64">
            <SelectValue placeholder="Add a skill" />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {domains.map((d) => {
              const open = skills.filter((s) => s.domain === d && !value.includes(s.id));
              if (open.length === 0) return null;
              return (
                <SelectGroup key={d}>
                  <SelectLabel>{d}</SelectLabel>
                  {open.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              );
            })}
          </SelectContent>
        </Select>
        <div className="flex gap-2 sm:ml-auto">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setValue(server);
              setError(null);
            }}
            disabled={!changed || saving}
            className="px-3.5"
          >
            Reset
          </Button>
          <Button type="button" onClick={save} disabled={!changed || !valid || saving} className="px-3.5">
            {saving ? 'Saving…' : 'Save focus'}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
