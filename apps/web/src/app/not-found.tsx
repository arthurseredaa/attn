import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div>
      <h1 className="text-2xl leading-tight font-semibold tracking-[-0.025em] sm:text-[28px]">Page not found</h1>
      <EmptyState title="There is nothing at this address." className="py-6">
        {/* Wrapped: EmptyDescription underlines its direct child links. */}
        <div className="mt-3">
          <Button asChild variant="outline" className="px-3.5">
            <Link href="/">Back to the home page</Link>
          </Button>
        </div>
      </EmptyState>
    </div>
  );
}
