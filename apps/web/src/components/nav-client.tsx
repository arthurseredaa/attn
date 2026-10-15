'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isOnboardingPath } from '@/lib/nav-items';

const brandClass = 'text-lg font-bold tracking-tight';

/** The brand; on onboarding it is plain text, not a link that leaves the flow. */
export function Brand() {
  const pathname = usePathname();
  if (isOnboardingPath(pathname)) return <span className={brandClass}>ATTN</span>;
  return (
    <Link href="/" className={brandClass}>
      ATTN
    </Link>
  );
}

/** Renders its children everywhere except on the onboarding flow (route-driven, so it also holds for "Redo onboarding"). */
export function HideOnOnboarding({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return isOnboardingPath(pathname) ? null : <>{children}</>;
}
