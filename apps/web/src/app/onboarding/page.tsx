import { OnboardingFlow } from '@/components/onboarding/onboarding-flow';
import { getProfile, getTaxonomy } from '@/lib/api';
import { requireMe } from '@/lib/guards';

export const metadata = { title: 'Onboarding | ATTN' };

export default async function OnboardingPage() {
  const me = await requireMe();
  const [taxonomy, profile] = await Promise.all([getTaxonomy(), getProfile()]);
  const initialFocus = profile.focus.map((f) => f.skillId);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{profile.onboarded ? 'Redo onboarding' : 'Choose your focus'}</h1>
      <OnboardingFlow taxonomy={taxonomy} role={me.role} initialFocus={initialFocus} />
    </div>
  );
}
