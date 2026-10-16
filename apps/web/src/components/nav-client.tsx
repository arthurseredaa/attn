'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { House, List, LogIn, UserRound, type LucideIcon } from 'lucide-react';
import type { Me } from '@attn/shared';
import { cn } from '@/lib/utils';
import { isLandingPath, isOnboardingPath, type NavItem } from '@/lib/nav-items';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SignOutButton } from './sign-out-button';
import { DotLogo } from './dot-logo';
import { ThemeToggle } from './theme-toggle';

const ICONS: Record<string, LucideIcon> = { '/for-you': House, '/all': List, '/profile': UserRound };

const brandClass =
  'inline-flex items-center rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring';

/** The brand, the dot-matrix logo; on onboarding it is not a link, so it does not lead out of the flow. */
export function Brand({ className }: { className?: string }) {
  const pathname = usePathname();
  const logo = (
    <>
      <DotLogo />
      <span className="sr-only">attn</span>
    </>
  );
  if (isOnboardingPath(pathname)) return <span className={cn(brandClass, className)}>{logo}</span>;
  return (
    <Link href="/" className={cn(brandClass, className)}>
      {logo}
    </Link>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : name.slice(0, 2);
  return letters.toUpperCase();
}

function NavUser({ me }: { me: Me }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const displayName = me.name ?? me.login;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          tooltip={displayName}
          aria-label={`Account menu for ${displayName}`}
          className="min-w-0 flex-1 px-1 text-sidebar-foreground data-[state=open]:bg-sidebar-accent"
        >
          <Avatar className="size-7 rounded-full after:rounded-full">
            {me.avatarUrl ? <AvatarImage src={me.avatarUrl} alt="" className="rounded-full" /> : null}
            <AvatarFallback className="rounded-full bg-foreground text-[13px] font-semibold text-background">
              {initials(displayName)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{displayName}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={isMobile ? 'top' : 'right'} align="end" sideOffset={8} className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">@{me.login}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile" onClick={() => setOpenMobile(false)}>
            <UserRound aria-hidden />
            Profile
          </Link>
        </DropdownMenuItem>
        <SignOutButton />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AppSidebar({ me, items }: { me: Me | null; items: NavItem[] }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="mb-5 px-3 pt-4 pb-0">
        <div className="flex h-9 items-center justify-between gap-2 pr-1 pl-2.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0">
          <Brand className="group-data-[collapsible=icon]:hidden" />
          <Tooltip>
            <TooltipTrigger asChild>
              <SidebarTrigger className="text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent side="right">
              Toggle sidebar <kbd className="ml-1 font-mono text-[11px] opacity-70">⌘B</kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-3">
        <SidebarGroup role="navigation" aria-label="Main" className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {items.map((i) => {
                const active = pathname === i.href || (pathname?.startsWith(`${i.href}/`) ?? false);
                const Icon = ICONS[i.href] ?? List;
                return (
                  <SidebarMenuItem key={i.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={i.label}>
                      <Link
                        href={i.href}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => setOpenMobile(false)}
                      >
                        <Icon aria-hidden strokeWidth={1.75} />
                        <span>{i.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-3 pt-2 pb-4">
        {/* User on the left, theme on the right; stacked (theme on top) when collapsed to icons. */}
        <div className="flex items-center justify-between gap-2 pr-1 pl-1.5 group-data-[collapsible=icon]:flex-col-reverse group-data-[collapsible=icon]:gap-3 group-data-[collapsible=icon]:p-0">
          {me ? (
            <NavUser me={me} />
          ) : (
            <SidebarMenuButton
              asChild
              tooltip="Sign in with GitHub"
              className="min-w-0 flex-1 bg-primary font-semibold text-primary-foreground hover:bg-primary hover:text-primary-foreground hover:brightness-[.94] active:bg-primary active:text-primary-foreground"
            >
              {/* Plain anchor: this is an api redirect, not a Next route. */}
              <a href="/api/auth/github">
                <LogIn aria-hidden strokeWidth={1.75} />
                <span>Sign in with GitHub</span>
              </a>
            </SidebarMenuButton>
          )}
          <ThemeToggle side="right" />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

const contentPadding = 'px-4 pt-5 pb-12 md:px-10 md:pt-8 md:pb-16';

/**
 * Sidebar layout (collapsible to icons, Cmd/Ctrl+B, a sheet on mobile with a slim top bar). The onboarding flow gets
 * only a brand bar, so the user stays in the flow (route-driven, so it also holds for "Redo onboarding"). The landing page
 * is full screen too, with a slim bar: Browse all, For you (signed in), theme, Sign in (signed out).
 */
export function AppShell({
  me,
  items,
  defaultOpen,
  children,
}: {
  me: Me | null;
  items: NavItem[];
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  if (isLandingPath(pathname)) {
    // Full screen, no sidebar and no bar: the page draws its own gutters and carries its own actions.
    return <main className="min-h-svh">{children}</main>;
  }
  if (isOnboardingPath(pathname)) {
    return (
      <div className="min-h-svh">
        <header className="sticky top-0 z-30 border-b bg-background">
          <div className="flex h-14 items-center justify-between gap-2 px-4 md:px-10">
            <Brand />
            <ThemeToggle />
          </div>
        </header>
        <main className={contentPadding}>{children}</main>
      </div>
    );
  }
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar me={me} items={items} />
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-4 md:hidden">
          <SidebarTrigger className="-ml-1.5 text-muted-foreground" />
          <Brand />
        </header>
        <div className={cn('flex-1', contentPadding)}>{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
