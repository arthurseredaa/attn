'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenuButton } from '@/components/ui/sidebar';

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

// The icon follows the resolved theme through CSS, so it renders without a hydration mismatch.
const themeIcon = (
  <>
    <Sun className="dark:hidden" aria-hidden />
    <Moon className="hidden dark:block" aria-hidden />
  </>
);

/** Light / dark / system. `sidebar` renders the trigger as a sidebar menu row (icon-only with a tooltip when collapsed). */
export function ThemeToggle({ sidebar = false }: { sidebar?: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {sidebar ? (
          <SidebarMenuButton tooltip="Theme" aria-label="Change theme">
            {themeIcon}
            <span>Theme</span>
          </SidebarMenuButton>
        ) : (
          <Button variant="ghost" size="icon-sm" aria-label="Change theme" className="text-muted-foreground hover:text-foreground">
            {themeIcon}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={sidebar ? 'start' : 'end'} side={sidebar ? 'top' : 'bottom'} className="w-36">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          {THEMES.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
