import { describe, expect, it } from 'vitest';
import { isOnboardingPath } from './nav-items';

describe('isOnboardingPath', () => {
  it('is true for the onboarding flow', () => {
    expect(isOnboardingPath('/onboarding')).toBe(true);
    expect(isOnboardingPath('/onboarding/quiz')).toBe(true);
  });
  it('is false elsewhere', () => {
    for (const p of ['/', '/for-you', '/all', '/profile', '/onboardingx', null]) expect(isOnboardingPath(p)).toBe(false);
  });
});
