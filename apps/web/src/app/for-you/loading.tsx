import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

function TileSkeleton() {
  return (
    <Card className="h-full gap-3 rounded-xl border p-4 shadow-none ring-0">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-3 w-28" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <Skeleton className="h-3 w-40" />
      <div className="flex gap-1.5">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="mt-auto space-y-3 pt-1">
        <Separator />
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-8 w-20" />
          <div className="flex gap-1">
            <Skeleton className="size-8" />
            <Skeleton className="size-8" />
            <Skeleton className="size-8" />
            <Skeleton className="size-8" />
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your feed…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-full sm:w-72 lg:w-80" />
        <Skeleton className="h-9 w-full sm:w-40" />
      </div>
      {/* Same grid as FeedList. */}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <li key={i} className={i >= 4 ? 'hidden xl:block' : undefined}>
            <TileSkeleton />
          </li>
        ))}
      </ul>
    </div>
  );
}
