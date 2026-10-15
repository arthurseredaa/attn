import type { MouseEvent } from 'react';

/**
 * Anchor props for a feed card. The title link only opens the article and carries no handlers: it records nothing
 * (owner decision 2026-10-15). The Read button's link also records `read`: click (also ctrl/cmd-click and Enter)
 * and middle click.
 */
export function articleLinks(url: string, onRead: () => void) {
  const openLink = { href: url, target: '_blank', rel: 'noopener noreferrer' } as const;
  const readLink = {
    ...openLink,
    onClick: () => onRead(),
    onAuxClick: (e: Pick<MouseEvent, 'button'>) => {
      if (e.button === 1) onRead();
    },
  };
  return { openLink, readLink };
}
