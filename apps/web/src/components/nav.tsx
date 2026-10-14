import Link from 'next/link';
import { getMe } from '@/lib/api';
import { NAV_ITEMS } from '@/lib/nav-items';
import { SignOutButton } from './sign-out-button';

export async function Nav() {
  const me = await getMe();
  const items = NAV_ITEMS.filter((i) => i.auth === 'any' || me);
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex max-w-4xl items-center gap-6 px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight">
          ATTN
        </Link>
        <nav className="flex flex-1 gap-4 text-sm">
          {items.map((i) => (
            <Link key={i.href} href={i.href} className="text-muted hover:text-fg">
              {i.label}
            </Link>
          ))}
        </nav>
        {me ? (
          <div className="flex items-center gap-3 text-sm">
            {me.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- small GitHub avatar, no optimizer needed
              <img src={me.avatarUrl} alt="" width={28} height={28} className="rounded-full" />
            ) : null}
            <span className="hidden sm:inline">{me.name ?? me.login}</span>
            <SignOutButton />
          </div>
        ) : (
          // Plain anchor: this is an api redirect, not a Next route.
          <a href="/api/auth/github" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg">
            Sign in with GitHub
          </a>
        )}
      </div>
    </header>
  );
}
