import { describe, expect, it } from 'vitest';
import { robotsTag } from './indexing';

describe('robotsTag', () => {
  it('is noindex when SITE_INDEXABLE is unset, empty or false', () => {
    expect(robotsTag(undefined)).toBe('noindex');
    expect(robotsTag('')).toBe('noindex');
    expect(robotsTag('false')).toBe('noindex');
  });

  it('opens only on exactly "true"', () => {
    expect(robotsTag('TRUE')).toBe('noindex');
    expect(robotsTag('1')).toBe('noindex');
    expect(robotsTag(' true')).toBe('noindex');
    expect(robotsTag('true')).toBeNull();
  });
});
