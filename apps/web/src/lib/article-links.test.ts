import { describe, expect, it, vi } from 'vitest';
import { articleLinks } from './article-links';

describe('articleLinks', () => {
  it('the title link only opens the article: no handlers, so nothing is recorded', () => {
    const { openLink } = articleLinks('https://example.com/a', vi.fn());
    expect(openLink).toEqual({ href: 'https://example.com/a', target: '_blank', rel: 'noopener noreferrer' });
    expect('onClick' in openLink).toBe(false);
    expect('onAuxClick' in openLink).toBe(false);
  });

  it('the Read link records on click and on middle click only', () => {
    const onRead = vi.fn();
    const { readLink } = articleLinks('https://example.com/a', onRead);
    expect(readLink.href).toBe('https://example.com/a');
    readLink.onClick();
    expect(onRead).toHaveBeenCalledTimes(1);
    readLink.onAuxClick({ button: 2 });
    expect(onRead).toHaveBeenCalledTimes(1);
    readLink.onAuxClick({ button: 1 });
    expect(onRead).toHaveBeenCalledTimes(2);
  });
});
