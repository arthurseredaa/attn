'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronsUpDown, ListFilter, Search, X } from 'lucide-react';
import { MAX_FILTER_SKILLS, MAX_SEARCH_LENGTH, type SourceSummary, type Taxonomy } from '@attn/shared';
import { change, clear, commit, edit, initFilterState, syncProps, type FilterBarState, type FilterValues } from '@/lib/filter-state';
import { hasActiveFilters, toggleSkill } from '@/lib/filters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const DEBOUNCE_MS = 300;
// Radix Select has no empty value: this stands for "no source filter".
const ALL_SOURCES = '__all__';

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
  const id = useId();
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
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full bg-card sm:w-72 lg:w-80">
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search titles"
            value={v.q}
            maxLength={MAX_SEARCH_LENGTH}
            onChange={(e) => applyLater({ q: e.target.value })}
            placeholder="Search titles"
          />
        </InputGroup>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full justify-between gap-3 bg-card font-normal sm:w-auto sm:min-w-40">
              <span className="inline-flex items-center gap-2">
                <ListFilter aria-hidden className="text-muted-foreground" />
                Skills
                {v.skill.length > 0 ? (
                  <Badge className="h-5 min-w-5 px-1.5 font-mono tabular-nums">
                    <span className="sr-only">, </span>
                    {v.skill.length}
                    <span className="sr-only"> selected</span>
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">All</span>
                )}
              </span>
              <ChevronsUpDown aria-hidden className="text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-72 gap-0 p-0">
            <Command>
              <CommandInput placeholder="Search skills" aria-label="Search skills" />
              <CommandList className="max-h-80">
                <CommandEmpty>No skills found.</CommandEmpty>
                {taxonomy.domains.map((d) => (
                  <CommandGroup key={d.id} heading={d.name}>
                    {d.skills.map((s) => {
                      const checked = v.skill.includes(s.id);
                      return (
                        <CommandItem
                          key={s.id}
                          value={s.id}
                          keywords={[s.name, d.name]}
                          aria-checked={checked}
                          disabled={!checked && v.skill.length >= MAX_FILTER_SKILLS}
                          onSelect={() => applyNow({ skill: toggleSkill(v.skill, s.id) })}
                        >
                          {/* Visual only: the option itself is the control (aria-checked above). */}
                          <Checkbox checked={checked} tabIndex={-1} aria-hidden className="pointer-events-none" />
                          <span className="truncate">{s.name}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
              </CommandList>
              <Separator />
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Up to {MAX_FILTER_SKILLS} skills; an article matches if it has any of them.
              </p>
            </Command>
          </PopoverContent>
        </Popover>
        {active ? (
          <div className="flex flex-wrap items-center gap-2 sm:ml-1">
            {v.skill.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Selected skills">
                {v.skill.map((id) => {
                  const name = names.get(id) ?? id;
                  return (
                    <li key={id}>
                      <Badge asChild variant="secondary" className="h-6 gap-1 pr-1.5 pl-2.5 font-normal hover:bg-secondary/70">
                        <button
                          type="button"
                          aria-label={`Remove skill filter: ${name}`}
                          onClick={() => applyNow({ skill: v.skill.filter((s) => s !== id) })}
                        >
                          {name}
                          <X aria-hidden className="text-muted-foreground" />
                        </button>
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <Button type="button" variant="ghost" size="xs" onClick={clearAll} className="text-muted-foreground hover:text-foreground">
              Clear filters
            </Button>
          </div>
        ) : null}
      </div>

      {sources ? (
        <div className="grid gap-3 sm:grid-cols-3 lg:max-w-3xl">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-source`} className="text-xs text-muted-foreground">
              Source
            </Label>
            <Select
              value={v.source ?? ALL_SOURCES}
              onValueChange={(value) => applyNow({ source: value === ALL_SOURCES ? undefined : value })}
            >
              <SelectTrigger id={`${id}-source`} className="w-full bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SOURCES}>All sources</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-from`} className="text-xs text-muted-foreground">
              From
            </Label>
            <Input
              id={`${id}-from`}
              type="date"
              value={v.from ?? ''}
              onChange={(e) => applyLater({ from: e.target.value || undefined })}
              className="bg-card"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-to`} className="text-xs text-muted-foreground">
              To
            </Label>
            <Input
              id={`${id}-to`}
              type="date"
              value={v.to ?? ''}
              onChange={(e) => applyLater({ to: e.target.value || undefined })}
              className="bg-card"
            />
          </div>
        </div>
      ) : null}

    </div>
  );
}
