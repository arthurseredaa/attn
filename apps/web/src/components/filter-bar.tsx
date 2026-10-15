'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, Search } from 'lucide-react';
import { MAX_FILTER_SKILLS, MAX_SEARCH_LENGTH, type SourceSummary, type Taxonomy } from '@attn/shared';
import { change, clear, commit, edit, initFilterState, syncProps, type FilterBarState, type FilterValues } from '@/lib/filter-state';
import { hasActiveFilters, toggleSkill } from '@/lib/filters';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const DEBOUNCE_MS = 300;
// Radix Select has no empty value: this stands for "no source filter".
const ALL_SOURCES = '__all__';
// All's one filter row: on phones the skills and source controls go two per line under the full-width search.
const HALF_ROW = 'min-w-0 flex-[1_1_calc(50%-4px)]';

/**
 * Filters shared by For you and All, kept in the URL: title search, skills (multi-select, any-match), and on All also
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

  const first = v.skill[0];
  const more = v.skill.length - 1;

  return (
    <div className={cn(!sources && 'w-full sm:w-auto')} role="search" aria-label="Filter articles">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className={sources ? 'sm:flex-[3_1_220px]' : 'w-full sm:w-[260px]'}>
          <InputGroupAddon className="pl-2.5">
            <Search aria-hidden strokeWidth={1.75} />
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
            <Button
              variant="outline"
              className={cn(
                'min-w-0 justify-between gap-2 px-2.5 font-normal',
                sources ? HALF_ROW + ' sm:flex-[1_1_170px]' : 'flex-1 sm:max-w-60 sm:flex-none',
              )}
            >
              <span className="flex min-w-0 items-baseline gap-1">
                {first ? (
                  <>
                    <span className="sr-only">Skills: </span>
                    <span className="truncate">{names.get(first) ?? first}</span>
                    {more > 0 ? (
                      <span className="text-muted-foreground">
                        +{more}
                        <span className="sr-only"> more</span>
                      </span>
                    ) : null}
                  </>
                ) : (
                  'Skills'
                )}
              </span>
              <ChevronDown aria-hidden strokeWidth={1.75} className="text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align={sources ? 'start' : 'end'} className="w-[min(280px,calc(100vw-2rem))] gap-0 p-0">
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
                          className="gap-2.5"
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
              <Separator className="mt-1" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={v.skill.length === 0}
                onClick={() => applyNow({ skill: [] })}
                className="mt-1 justify-start px-2 font-normal text-muted-foreground"
              >
                Clear
              </Button>
            </Command>
          </PopoverContent>
        </Popover>
        {sources ? (
          <>
            <Select
              value={v.source ?? ALL_SOURCES}
              onValueChange={(value) => applyNow({ source: value === ALL_SOURCES ? undefined : value })}
            >
              <SelectTrigger aria-label="Source" className={cn(HALF_ROW, 'sm:flex-[1_1_160px]')}>
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
            {/* The dates wrap as a pair, so a narrow row breaks between whole groups. */}
            <div className="flex min-w-0 basis-full gap-2 sm:max-w-md sm:flex-[2_1_308px]">
              {(['from', 'to'] as const).map((key) => (
                <InputGroup key={key} className="min-w-0 flex-1">
                  <InputGroupAddon className="pl-2.5">
                    <Label htmlFor={`${id}-${key}`} className="text-[13px] font-normal text-muted-foreground">
                      {key === 'from' ? 'From' : 'To'}
                    </Label>
                  </InputGroupAddon>
                  <InputGroupInput
                    id={`${id}-${key}`}
                    type="date"
                    value={v[key] ?? ''}
                    onChange={(e) => {
                      const date = e.target.value || undefined;
                      applyLater(key === 'from' ? { from: date } : { to: date });
                    }}
                    className="font-mono text-[13px] md:text-[13px] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-50 max-sm:[&::-webkit-calendar-picker-indicator]:hidden"
                  />
                </InputGroup>
              ))}
            </div>
            {active ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="font-normal text-muted-foreground"
              >
                Clear filters
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
