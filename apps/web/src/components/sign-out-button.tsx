'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

/** The "Sign out" entry of the account menu. */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/');
      router.refresh();
    }
  }

  return (
    <DropdownMenuItem disabled={busy} onSelect={() => void signOut()}>
      <LogOut aria-hidden />
      Sign out
    </DropdownMenuItem>
  );
}
