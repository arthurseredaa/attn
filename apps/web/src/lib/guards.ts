import { redirect } from 'next/navigation';
import type { Profile } from '@attn/shared';
import { ApiError, getProfile } from './api';

/** Awaits a server-side api call; a 401 (no session, or it expired meanwhile) redirects to the landing page. */
export async function signedIn<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/');
    throw e;
  }
}

/** The caller's profile, onboarded or not (one /profile call; it carries the role). No session -> `/`. */
export function requireSession(): Promise<Profile> {
  return signedIn(getProfile());
}

/** No session -> `/`; not onboarded -> `/onboarding`. */
export async function requireProfile(): Promise<Profile> {
  const profile = await requireSession();
  if (!profile.onboarded) redirect('/onboarding');
  return profile;
}
