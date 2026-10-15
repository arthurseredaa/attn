'use client';

import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div>
      <h1 className="text-2xl leading-tight font-semibold tracking-[-0.025em] sm:text-[28px]">Something went wrong</h1>
      <EmptyState title="The page could not be loaded. Please try again." className="py-6">
        <div className="mt-3">
          <Button type="button" variant="outline" className="px-3.5" onClick={reset}>
            Try again
          </Button>
        </div>
      </EmptyState>
    </div>
  );
}
