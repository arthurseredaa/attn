import type { ReactNode } from 'react';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { cn } from '@/lib/utils';

/** An empty list: one quiet line in muted text, optionally followed by a link or two. */
export function EmptyState({
  title,
  children,
  className,
}: {
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn('items-start justify-start gap-0 rounded-none border-0 px-0 py-12 text-left', className)}>
      <EmptyHeader className="max-w-none items-start gap-1">
        <EmptyTitle className="text-[15px] font-normal text-muted-foreground">{title}</EmptyTitle>
        {children ? <EmptyDescription>{children}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  );
}
