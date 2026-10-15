export interface NavItem {
  href: string;
  label: string;
  /** 'user' items are shown only when signed in. */
  auth: 'any' | 'user';
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/for-you', label: 'For you', auth: 'user' },
  { href: '/all', label: 'All', auth: 'any' },
  { href: '/profile', label: 'Profile', auth: 'user' },
];

/** The onboarding flow (/onboarding, /onboarding/quiz): the header shows only the brand, so the user stays in the flow. */
export function isOnboardingPath(pathname: string | null): boolean {
  return pathname === '/onboarding' || (pathname?.startsWith('/onboarding/') ?? false);
}

/** The landing page: full screen, no sidebar, a slim bar with its own links. */
export function isLandingPath(pathname: string | null): boolean {
  return pathname === '/';
}
