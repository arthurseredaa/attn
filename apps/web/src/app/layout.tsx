import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { Nav } from '@/components/nav';
import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

// Self-hosted from @fontsource-variable (latin, variable weight), so builds work offline.
const sans = localFont({
  src: '../../node_modules/@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-hanken-grotesk',
});
const mono = localFont({
  src: '../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  title: 'ATTN',
  description: 'AI articles ranked by your skill priorities and level.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes sets the theme class on <html> before hydration.
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            <Nav>{children}</Nav>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
