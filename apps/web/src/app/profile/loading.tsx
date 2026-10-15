import { SKILL_ROW_GRID, SKILL_ROWS } from '@/components/profile/skill-row';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const NAME_WIDTHS = ['w-2/5', 'w-1/3', 'w-1/2', 'w-1/4', 'w-2/5'];

function RowSkeleton({ name }: { name: string }) {
  return (
    <li className={SKILL_ROW_GRID}>
      <Skeleton className={cn('h-4', name)} />
      <Skeleton className="h-3.5 w-32" />
      <Skeleton className="col-span-2 h-3.5 w-12 @min-[640px]:col-span-1 @min-[640px]:ml-auto" />
    </li>
  );
}

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-10">
      <span className="sr-only">Loading your profile…</span>
      {/* Same header as the page: the title left, the actions right. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-9 w-36" />
      </div>
      {/* The radars. */}
      <div className="@container">
        <div className="grid gap-x-10 gap-y-8 @min-[760px]:max-w-[840px] @min-[760px]:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className={cn('space-y-1', i === 1 && 'hidden @min-[760px]:block')}>
              <Skeleton className="h-5 w-16" />
              <Skeleton className="mx-auto aspect-square w-full max-w-[380px] rounded-lg @min-[760px]:mx-0" />
            </div>
          ))}
        </div>
      </div>
      {/* One domain's skill rows. */}
      <div>
        <Skeleton className="mb-2 h-6 w-40" />
        <ul role="list" className={SKILL_ROWS}>
          {NAME_WIDTHS.map((w, i) => (
            <RowSkeleton key={i} name={w} />
          ))}
        </ul>
      </div>
    </div>
  );
}
