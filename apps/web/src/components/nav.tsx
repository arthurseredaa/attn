import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { getMe } from '@/lib/api';
import { NAV_ITEMS } from '@/lib/nav-items';
import { AppShell } from './nav-client';

/** The shadcn Sidebar's own cookie: the expanded/collapsed state survives reloads. */
const SIDEBAR_COOKIE = 'sidebar_state';

/** App chrome: the sidebar nav (a sheet on mobile) around the page; on onboarding and the landing page a slim top bar. */
export async function Nav({ children }: { children: ReactNode }) {
  const [me, cookieStore] = await Promise.all([getMe(), cookies()]);
  const items = NAV_ITEMS.filter((i) => i.auth === 'any' || me);
  const sidebarOpen = cookieStore.get(SIDEBAR_COOKIE)?.value !== 'false';
  return (
    <AppShell me={me} items={items} defaultOpen={sidebarOpen}>
      {children}
    </AppShell>
  );
}
