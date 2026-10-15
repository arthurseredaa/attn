import { FlipTitle } from '@/components/onboarding/flip-title';
import { OnboardingFlow } from '@/components/onboarding/onboarding-flow';
import { getTaxonomy } from '@/lib/api';
import { requireSession } from '@/lib/guards';

export const metadata = { title: 'Onboarding | ATTN' };

export default async function OnboardingPage() {
  const [profile, taxonomy] = await Promise.all([requireSession(), getTaxonomy()]);
  const initialFocus = profile.focus.map((f) => f.skillId);
  return (
    <div className="space-y-5">
      <FlipTitle
        text={profile.onboarded ? 'Redo onboarding' : 'Choose your focus'}
        className="text-[36px] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[44px] lg:text-[52px]"
      />
      <OnboardingFlow taxonomy={taxonomy} role={profile.role} initialFocus={initialFocus} />
    </div>
  );
}
