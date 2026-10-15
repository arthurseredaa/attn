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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

// The icon follows the resolved theme through CSS, so it renders without a hydration mismatch.
const themeIcon = (
  <>
    <Sun className="dark:hidden" aria-hidden strokeWidth={1.75} />
    <Moon className="hidden dark:block" aria-hidden strokeWidth={1.75} />
  </>
);

/** Light / dark / system, behind an icon button with a "Theme" tooltip. `side` places the tooltip and the menu. */
export function ThemeToggle({ side = 'bottom' }: { side?: 'top' | 'right' | 'bottom' }) {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Change theme" className="text-muted-foreground">
              {themeIcon}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={side}>Theme</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" side={side} className="w-36">
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
