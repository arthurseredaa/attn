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
