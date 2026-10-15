import { ROW_GRID, ROWS_LIST } from '@/components/article-card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Varied title widths so the skeleton reads as a list, not a block.
const TITLE_WIDTHS = ['w-4/5', 'w-3/5', 'w-11/12', 'w-2/3', 'w-3/4', 'w-1/2', 'w-5/6', 'w-2/5', 'w-3/4', 'w-3/5'];

function RowSkeleton({ title }: { title: string }) {
  return (
    <li className={ROW_GRID}>
      <Skeleton className="row-span-2 size-4 self-start @min-[600px]:row-span-1 @min-[600px]:self-auto" />
      <Skeleton
        className={cn(
          'col-start-2 row-start-1 h-4 @min-[600px]:order-2 @min-[600px]:col-start-auto @min-[600px]:row-start-auto',
          title,
        )}
      />
      <div className="col-start-2 row-start-2 flex min-w-0 items-center gap-2 @min-[600px]:contents">
        <Skeleton className="h-2.5 w-[23px] @min-[600px]:order-1" />
        <Skeleton className="h-3.5 w-28 @min-[600px]:order-3" />
        <Skeleton className="h-3.5 w-20 @min-[600px]:order-3 @min-[600px]:hidden @min-[800px]:block" />
        <Skeleton className="h-3.5 w-10 @min-[600px]:order-3 @min-[600px]:ml-auto" />
        <Skeleton className="h-3.5 w-10 @min-[600px]:order-3 @min-[600px]:ml-auto" />
      </div>
    </li>
  );
}

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading articles…</span>
      {/* Same header as the page: the title, then one filter row. */}
      <Skeleton className="mb-4 h-8 w-16 sm:mb-5" />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-full sm:w-auto sm:flex-[3_1_220px]" />
        <Skeleton className="h-9 flex-[1_1_calc(50%-4px)] sm:flex-[1_1_170px]" />
        <Skeleton className="h-9 flex-[1_1_calc(50%-4px)] sm:flex-[1_1_160px]" />
        <div className="flex basis-full gap-2 sm:max-w-md sm:flex-[2_1_308px]">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 flex-1" />
        </div>
      </div>
      <ul role="list" className={cn('mt-3', ROWS_LIST)}>
        {TITLE_WIDTHS.map((w, i) => (
          <RowSkeleton key={i} title={w} />
        ))}
      </ul>
    </div>
  );
}
