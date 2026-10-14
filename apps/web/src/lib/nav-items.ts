export interface NavItem {
  href: string;
  label: string;
  /** 'user' items are shown only when signed in. Stages 4-5 add Profile and For you here. */
  auth: 'any' | 'user';
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/all', label: 'All', auth: 'any' },
  { href: '/profile', label: 'Profile', auth: 'user' },
];
