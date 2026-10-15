'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { MAX_FOCUS, profileSchema, type FocusEntry } from '@attn/shared';
import { BrowserApiError, browserJson } from '@/lib/browser-api';
import { toggleSkill } from '@/lib/reorder';
import { SortableList } from '@/components/onboarding/sortable-list';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Wide containers: two columns, a chart on the left of each row (domains, then focus) with the focus list and its
 * controls on the right. Narrow: one column in reading order (domains, focus chart, list, controls). Without a focus
 * chart the controls sit under the list. */
const CELL = {
  domains: '@min-[760px]:col-start-1 @min-[760px]:row-start-1',
  focusChart: '@min-[760px]:col-start-1 @min-[760px]:row-start-2',
  list: '@min-[760px]:col-start-2 @min-[760px]:row-start-1',
  controls: '@min-[760px]:col-start-2 @min-[760px]:row-start-2',
};

export function FocusEditor({
  focus,
  skills,
  names,
  domainsChart,
  focusChart,
}: {
  focus: FocusEntry[];
  domainsChart: ReactNode;
  /** null when there are too few focus skills for a radar. */
  focusChart: ReactNode | null;
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

  const controls = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
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
    </div>
  );

  return (
    <div className="@container">
      <div className="grid gap-x-12 gap-y-8 @min-[760px]:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className={CELL.domains}>{domainsChart}</div>
        {focusChart ? <div className={CELL.focusChart}>{focusChart}</div> : null}
        <section aria-labelledby="focus-editor-heading" className={`space-y-3 ${CELL.list}`}>
          <h2 id="focus-editor-heading" className="text-sm font-semibold">
            Focus skills
          </h2>
          <SortableList
            items={value}
            labels={names}
            renderLabel={(id) => names[id] ?? id}
            onChange={setValue}
            emptyText="Pick at least one focus skill."
          />
          {focusChart ? null : controls}
        </section>
        {focusChart ? <div className={CELL.controls}>{controls}</div> : null}
      </div>
    </div>
  );
}
