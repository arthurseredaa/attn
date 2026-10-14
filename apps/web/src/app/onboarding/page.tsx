import { OnboardingFlow } from '@/components/onboarding/onboarding-flow';
import { getTaxonomy } from '@/lib/api';
import { requireSession } from '@/lib/guards';

export const metadata = { title: 'Onboarding | ATTN' };

export default async function OnboardingPage() {
  const [profile, taxonomy] = await Promise.all([requireSession(), getTaxonomy()]);
  const initialFocus = profile.focus.map((f) => f.skillId);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{profile.onboarded ? 'Redo onboarding' : 'Choose your focus'}</h1>
      <OnboardingFlow taxonomy={taxonomy} role={profile.role} initialFocus={initialFocus} />
    </div>
  );
}
