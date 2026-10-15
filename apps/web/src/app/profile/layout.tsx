import { requireProfile } from '@/lib/guards';

// The guard runs here, outside loading.tsx's Suspense boundary, so a signed-out or not-onboarded visitor gets a real
// 307 instead of a streamed skeleton followed by a meta-refresh redirect.
export default async function ProfileLayout({ children }: { children: React.ReactNode }) {
  await requireProfile();
  return children;
}
