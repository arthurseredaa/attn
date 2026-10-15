'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronsUpDown, LogIn, Newspaper, Sparkles, UserRound, type LucideIcon } from 'lucide-react';
import type { Me } from '@attn/shared';
import { cn } from '@/lib/utils';
import { isOnboardingPath, type NavItem } from '@/lib/nav-items';
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
import { ThemeToggle } from './theme-toggle';

const ICONS: Record<string, LucideIcon> = { '/for-you': Sparkles, '/all': Newspaper, '/profile': UserRound };

const brandClass =
  'flex items-center gap-2 rounded-md text-base font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

function BrandMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('grid size-6 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground', className)}>
      <span className="size-2 rounded-full bg-current" />
    </span>
  );
}

/** The brand; on onboarding it is plain text, not a link that leaves the flow. */
export function Brand({ className }: { className?: string }) {
  const pathname = usePathname();
  if (isOnboardingPath(pathname)) {
    return (
      <span className={cn(brandClass, className)}>
        <BrandMark />
        ATTN
      </span>
    );
  }
  return (
    <Link href="/" className={cn(brandClass, className)}>
      <BrandMark />
      ATTN
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
          size="lg"
          tooltip={displayName}
          aria-label={`Account menu for ${displayName}`}
          className="data-[state=open]:bg-sidebar-accent"
        >
          <Avatar className="size-8 rounded-lg after:rounded-lg">
            {me.avatarUrl ? <AvatarImage src={me.avatarUrl} alt="" className="rounded-lg" /> : null}
            <AvatarFallback className="rounded-lg text-xs font-medium">{initials(displayName)}</AvatarFallback>
          </Avatar>
          <span className="grid min-w-0 flex-1 text-left leading-tight">
            <span className="truncate text-sm font-medium">{displayName}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">@{me.login}</span>
          </span>
          <ChevronsUpDown aria-hidden className="ml-auto text-muted-foreground" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={isMobile ? 'top' : 'right'} align="end" sideOffset={8} className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
          <span className="truncate font-mono text-xs font-normal text-muted-foreground">@{me.login}</span>
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
      <SidebarHeader className="h-14 flex-row items-center justify-between gap-2 border-b px-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
        <Brand className="min-w-0 group-data-[collapsible=icon]:hidden" />
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
          </TooltipTrigger>
          <TooltipContent side="right">
            Toggle sidebar <kbd className="ml-1 font-mono text-[10px] opacity-70">⌘B</kbd>
          </TooltipContent>
        </Tooltip>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup role="navigation" aria-label="Main">
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((i) => {
                const active = pathname === i.href || (pathname?.startsWith(`${i.href}/`) ?? false);
                const Icon = ICONS[i.href] ?? Newspaper;
                return (
                  <SidebarMenuItem key={i.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={i.label}
                      className="text-muted-foreground hover:text-foreground data-[active=true]:text-foreground data-[active=true]:[&>svg]:text-primary"
                    >
                      <Link href={i.href} aria-current={active ? 'page' : undefined} onClick={() => setOpenMobile(false)}>
                        <Icon aria-hidden />
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
      <SidebarFooter className="border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeToggle sidebar />
          </SidebarMenuItem>
          <SidebarMenuItem>
            {me ? (
              <NavUser me={me} />
            ) : (
              <SidebarMenuButton
                asChild
                tooltip="Sign in with GitHub"
                className="bg-primary font-medium text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
              >
                {/* Plain anchor: this is an api redirect, not a Next route. */}
                <a href="/api/auth/github">
                  <LogIn aria-hidden />
                  <span>Sign in with GitHub</span>
                </a>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

const contentPadding = 'px-4 py-6 md:px-6 md:py-8 lg:px-8';

/**
 * Sidebar layout (collapsible to icons, Cmd/Ctrl+B, a sheet on mobile with a slim top bar). The onboarding flow gets
 * only a brand bar, so the user stays in the flow (route-driven, so it also holds for "Redo onboarding").
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
  if (isOnboardingPath(pathname)) {
    return (
      <div className="min-h-svh">
        <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/65">
          <div className="flex h-14 items-center justify-between gap-2 px-4 md:px-6 lg:px-8">
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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-backdrop-filter:bg-background/65 md:hidden">
          <SidebarTrigger className="-ml-1.5" />
          <Brand />
        </header>
        <div className={cn('flex-1', contentPadding)}>{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
