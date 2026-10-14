import { redirect } from 'next/navigation';
import type { Me, Profile } from '@attn/shared';
import { ApiError, getMe, getProfile } from './api';

export async function requireMe(): Promise<Me> {
  const me = await getMe();
  if (!me) redirect('/');
  return me;
}

export async function requireProfile(): Promise<Profile> {
  let profile: Profile;
  try {
    profile = await getProfile();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/');
    throw e;
  }
  if (!profile.onboarded) redirect('/onboarding');
  return profile;
}
