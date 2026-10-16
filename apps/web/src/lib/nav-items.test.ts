import { describe, expect, it } from 'vitest';
import { isLandingPath, isOnboardingPath } from './nav-items';

describe('isOnboardingPath', () => {
  it('is true for the onboarding flow', () => {
    expect(isOnboardingPath('/onboarding')).toBe(true);
    expect(isOnboardingPath('/onboarding/quiz')).toBe(true);
  });
  it('is false elsewhere', () => {
    for (const p of ['/', '/for-you', '/all', '/profile', '/onboardingx', null])
      expect(isOnboardingPath(p)).toBe(false);
  });
});

describe('isLandingPath', () => {
  it('is true only for the root', () => {
    expect(isLandingPath('/')).toBe(true);
    for (const p of ['/all', '/for-you', '/onboarding', '', null]) expect(isLandingPath(p)).toBe(false);
  });
});
