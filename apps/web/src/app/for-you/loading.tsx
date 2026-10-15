import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function TileSkeleton() {
  return (
    <Card className="h-full min-h-56 gap-0 px-[18px] py-0 pt-[18px] pb-4 sm:px-6 sm:pt-[22px] sm:pb-5">
      <div className="mb-2.5 flex items-center justify-between gap-3 sm:mb-3.5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="mb-2.5 space-y-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
      </div>
      <Skeleton className="h-4 w-44" />
      <div className="mt-auto flex items-center justify-between gap-3 pt-4 sm:pt-[22px]">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-36" />
      </div>
    </Card>
  );
}

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your feed…</span>
      {/* Same header row as the page: title left, filters right. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3.5 sm:mb-6 sm:gap-6">
        <Skeleton className="h-8 w-32" />
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Skeleton className="h-9 w-full sm:w-[260px]" />
          <Skeleton className="h-9 flex-1 sm:w-28 sm:flex-none" />
        </div>
      </div>
      {/* Same grid as FeedList. */}
      <div className="@container">
        <ul className="grid grid-cols-1 gap-3 @min-[560px]:grid-cols-2 @min-[560px]:gap-4 @min-[1000px]:grid-cols-3 @min-[1560px]:grid-cols-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i} className={i >= 3 ? 'hidden @min-[560px]:block' : undefined}>
              <TileSkeleton />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
