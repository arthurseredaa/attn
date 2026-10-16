# Analytics (PostHog) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PostHog analytics to `apps/web`: visitors and live users, an onboarding-to-first-article funnel, D1 retention, and feed click-through, behind a consent banner.

**Architecture:** `posthog-js` on the client, behind a same-origin `/ingest` proxy. A typed `track()` wrapper with an injected client keeps the call sites testable and makes analytics a no-op without a key. Pure modules (`consent`, `analytics`, `onboarding-url`) carry the logic and are unit-tested; React components are thin glue. Onboarding steps move into the URL with `history.pushState`, so `$pageview` is the step event.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, `posthog-js` 1.438.x, vitest (node environment, pure-function tests only; there is no jsdom in this repo).

**Spec:** `docs/superpowers/specs/2026-10-16-analytics-design.md`

## Global Constraints

- PostHog Cloud **EU**: UI host `https://eu.posthog.com`, ingest `https://eu.i.posthog.com`, assets `https://eu-assets.i.posthog.com`.
- Env: only `NEXT_PUBLIC_POSTHOG_KEY` (inlined at build time; Docker passes it as a build arg). No key means no analytics, no banner, no errors.
- Identify with `me.id` only. Never send email, login or name to PostHog.
- Consent: init with `opt_out_capturing_by_default: true` and `cookieless_mode: 'on_reject'`; Accept calls `opt_in_capturing()` and starts session replay; session inputs masked (`maskAllInputs: true`).
- Every `localStorage` access is wrapped in try/catch.
- `track` never throws.
- The API behaviour of `lib/article-links.ts` does not change: opening a title link still records nothing in the API.
- Change only what a task names. Code style follows the surrounding files: single quotes, 2-space indent, `@/` imports, comments only where the reason is not obvious.
- Tests: `pnpm --filter @attn/web test` (vitest, root config; needs Postgres up: `docker compose up -d --wait`, as for every test in this repo). Typecheck: `pnpm typecheck`. Lint: `pnpm lint`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **No key (local dev, CI, preview):** `track`, `identify`, `resetAnalytics` do nothing and do not throw; the banner does not render. Pinned in Task 2 and Task 4.
2. **`localStorage` blocked or throwing (private window, blocked site data):** consent reads as `pending`, writes are swallowed, the app renders. Pinned in Task 1.
3. **Reload or Forward onto `?step=quiz&q=3` with no answers:** clamps to question 1 and rewrites the URL; a bad `q` (`0`, `-1`, `abc`, `2.5`, empty) also clamps. Pinned in Task 3.
4. **An article with no skills:** `article_opened` carries `skill: null`, not a crash. Pinned in Task 2.
5. **Sign-out:** `reset()` wipes PostHog's stored consent; the stored choice must be re-applied right after, or capture silently stops. Pinned in Task 1 (`resetKeepingConsent`).

---

## File Structure

New, in `apps/web/src`:

- `lib/consent.ts`: `Consent` type, storage read/write, `applyConsent`, `resetKeepingConsent`, `browserStorage`. Pure apart from the injected store/client.
- `lib/analytics.ts`: event catalog types, injected `AnalyticsClient`, `track`/`identify`/`resetAnalytics`/`setConsent`, `articleOpenedProps`.
- `lib/onboarding-url.ts`: `quizIndexFromParam`, `withSearchParam`.
- `components/analytics-provider.tsx`: `startAnalytics`, `AnalyticsProvider` (init + `$pageview`), `AnalyticsIdentity`.
- `components/consent-banner.tsx`: the banner.
- `components/tracked-article-link.tsx`: the All-list title link with click tracking.
- Tests next to each lib file: `lib/consent.test.ts`, `lib/analytics.test.ts`, `lib/onboarding-url.test.ts`.

Modified: `package.json` (dep), `.env.example`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `docker-compose.yml`, `app/layout.tsx`, `components/nav.tsx`, `components/sign-out-button.tsx`, `components/onboarding/onboarding-flow.tsx`, `components/onboarding/quiz-runner.tsx`, `app/onboarding/page.tsx`, `components/landing/landing-story.tsx`, `components/nav-client.tsx`, `components/feed-list.tsx`, `components/feed-card.tsx`, `components/article-card.tsx`, `app/all/page.tsx`, `lib/article-links.ts` (a comment only), `README.md`.

---

### Task 1: Dependency, env, and consent logic

**Files:**
- Modify: `apps/web/package.json` (via pnpm), `.env.example`
- Create: `apps/web/src/lib/consent.ts`
- Test: `apps/web/src/lib/consent.test.ts`

**Interfaces:**
- Produces:
  - `type Consent = 'granted' | 'denied' | 'pending'`
  - `const CONSENT_KEY: string`
  - `parseConsent(raw: string | null | undefined): Consent`
  - `type ConsentStore = Pick<Storage, 'getItem' | 'setItem'>`
  - `readConsent(store: ConsentStore | null): Consent`
  - `writeConsent(store: ConsentStore | null, value: 'granted' | 'denied'): void`
  - `interface ConsentTarget { opt_in_capturing(options?: { captureEventName?: false }): void; opt_out_capturing(): void; startSessionRecording(): void; stopSessionRecording(): void; reset(): void }`
  - `applyConsent(target: ConsentTarget, consent: Consent): void`
  - `resetKeepingConsent(target: ConsentTarget, store: ConsentStore | null): void`
  - `browserStorage(): Storage | null`

- [ ] **Step 1: Install the dependency and add the env example**

Run: `pnpm --filter @attn/web add posthog-js@1.438.12`
Expected: `posthog-js` appears in `apps/web/package.json` dependencies, lockfile updated.

Append to `.env.example` (after the `API_URL` comment line):

```
# Optional: PostHog project API key (phc_...) for analytics in apps/web. Inlined at build time (Docker: build arg).
# Unset means no analytics and no consent banner.
# NEXT_PUBLIC_POSTHOG_KEY=
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/lib/consent.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  CONSENT_KEY,
  applyConsent,
  parseConsent,
  readConsent,
  resetKeepingConsent,
  writeConsent,
  type ConsentTarget,
} from './consent';

function target(): ConsentTarget {
  return {
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    startSessionRecording: vi.fn(),
    stopSessionRecording: vi.fn(),
    reset: vi.fn(),
  };
}

const throwingStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('parseConsent', () => {
  it('accepts only the two stored values; anything else is pending', () => {
    expect(parseConsent('granted')).toBe('granted');
    expect(parseConsent('denied')).toBe('denied');
    for (const raw of [null, undefined, '', 'yes', 'GRANTED']) expect(parseConsent(raw)).toBe('pending');
  });
});

describe('readConsent / writeConsent', () => {
  it('round-trips through a store', () => {
    const map = new Map<string, string>();
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    expect(readConsent(store)).toBe('pending');
    writeConsent(store, 'granted');
    expect(map.get(CONSENT_KEY)).toBe('granted');
    expect(readConsent(store)).toBe('granted');
  });

  it('a null or throwing store reads as pending and never throws on write', () => {
    expect(readConsent(null)).toBe('pending');
    expect(readConsent(throwingStore)).toBe('pending');
    expect(() => writeConsent(null, 'denied')).not.toThrow();
    expect(() => writeConsent(throwingStore, 'denied')).not.toThrow();
  });
});

describe('applyConsent', () => {
  it('granted opts in without an $opt_in event and starts session replay', () => {
    const t = target();
    applyConsent(t, 'granted');
    expect(t.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
    expect(t.startSessionRecording).toHaveBeenCalledOnce();
    expect(t.opt_out_capturing).not.toHaveBeenCalled();
  });

  it('denied opts out and stops replay', () => {
    const t = target();
    applyConsent(t, 'denied');
    expect(t.opt_out_capturing).toHaveBeenCalledOnce();
    expect(t.stopSessionRecording).toHaveBeenCalledOnce();
    expect(t.opt_in_capturing).not.toHaveBeenCalled();
  });

  it('pending leaves the init defaults alone (cookieless capture, no replay)', () => {
    const t = target();
    applyConsent(t, 'pending');
    expect(t.opt_in_capturing).not.toHaveBeenCalled();
    expect(t.opt_out_capturing).not.toHaveBeenCalled();
    expect(t.startSessionRecording).not.toHaveBeenCalled();
  });
});

describe('resetKeepingConsent', () => {
  it('resets first, then re-applies the stored choice (reset clears consent)', () => {
    const t = target();
    const order: string[] = [];
    (t.reset as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('reset'));
    (t.opt_in_capturing as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('opt_in'));
    const store = { getItem: () => 'granted', setItem: () => undefined };
    resetKeepingConsent(t, store);
    expect(order).toEqual(['reset', 'opt_in']);
  });

  it('with no readable store it only resets', () => {
    const t = target();
    resetKeepingConsent(t, throwingStore);
    expect(t.reset).toHaveBeenCalledOnce();
    expect(t.opt_in_capturing).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @attn/web test -- consent`
Expected: FAIL, `Cannot find module './consent'`.

- [ ] **Step 4: Implement `lib/consent.ts`**

```ts
export type Consent = 'granted' | 'denied' | 'pending';

export const CONSENT_KEY = 'attn:analytics-consent';

export type ConsentStore = Pick<Storage, 'getItem' | 'setItem'>;

/** The slice of the posthog-js instance this module drives. */
export interface ConsentTarget {
  opt_in_capturing(options?: { captureEventName?: false }): void;
  opt_out_capturing(): void;
  startSessionRecording(): void;
  stopSessionRecording(): void;
  reset(): void;
}

export function parseConsent(raw: string | null | undefined): Consent {
  return raw === 'granted' || raw === 'denied' ? raw : 'pending';
}

export function readConsent(store: ConsentStore | null): Consent {
  try {
    return parseConsent(store?.getItem(CONSENT_KEY));
  } catch {
    return 'pending';
  }
}

export function writeConsent(store: ConsentStore | null, value: 'granted' | 'denied'): void {
  try {
    store?.setItem(CONSENT_KEY, value);
  } catch {
    // storage blocked: the choice lasts until the next reload
  }
}

/** Undecided keeps the init defaults: cookieless capture, no replay. */
export function applyConsent(target: ConsentTarget, consent: Consent): void {
  if (consent === 'granted') {
    target.opt_in_capturing({ captureEventName: false });
    target.startSessionRecording();
  } else if (consent === 'denied') {
    target.opt_out_capturing();
    target.stopSessionRecording();
  }
}

/** posthog-js `reset()` clears consent too, so a reset without this would silently stop capturing. */
export function resetKeepingConsent(target: ConsentTarget, store: ConsentStore | null): void {
  target.reset();
  applyConsent(target, readConsent(store));
}

export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @attn/web test -- consent`
Expected: PASS (all `consent` tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml .env.example apps/web/src/lib/consent.ts apps/web/src/lib/consent.test.ts
git commit -m "feat(web): analytics consent logic and posthog-js dependency

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The typed analytics module

**Files:**
- Create: `apps/web/src/lib/analytics.ts`
- Test: `apps/web/src/lib/analytics.test.ts`

**Interfaces:**
- Consumes: `Consent` from `lib/consent.ts`; `ArticleCard` from `@attn/shared`.
- Produces:
  - `type AnalyticsEvents` (the catalog below)
  - `interface AnalyticsClient { capture(event: string, props?: Record<string, unknown>): void; identify(id: string): void; reset(): void; applyConsent(consent: Consent): void }`
  - `setAnalyticsClient(client: AnalyticsClient | null): void`
  - `track<E extends keyof AnalyticsEvents>(event: E, props: AnalyticsEvents[E]): void`
  - `identify(id: string): void`, `resetAnalytics(): void`, `setConsent(consent: Consent): void`
  - `articleOpenedProps(article: ArticleCard, position: number, via: 'title' | 'read_button', surface: 'for_you' | 'all'): AnalyticsEvents['article_opened']`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/analytics.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArticleCard } from '@attn/shared';
import {
  articleOpenedProps,
  identify,
  resetAnalytics,
  setAnalyticsClient,
  setConsent,
  track,
  type AnalyticsClient,
} from './analytics';

function client(): AnalyticsClient {
  return { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), applyConsent: vi.fn() };
}

afterEach(() => setAnalyticsClient(null));

describe('without a client (no key, or before init)', () => {
  it('every entry point is a silent no-op', () => {
    expect(() => {
      track('signin_clicked', { from: 'landing' });
      identify('u1');
      resetAnalytics();
      setConsent('granted');
    }).not.toThrow();
  });
});

describe('with a client', () => {
  it('passes the event and its properties through', () => {
    const c = client();
    setAnalyticsClient(c);
    track('onboarding_skipped', { redo: false });
    expect(c.capture).toHaveBeenCalledWith('onboarding_skipped', { redo: false });
  });

  it('forwards identify, reset and consent', () => {
    const c = client();
    setAnalyticsClient(c);
    identify('u1');
    resetAnalytics();
    setConsent('denied');
    expect(c.identify).toHaveBeenCalledWith('u1');
    expect(c.reset).toHaveBeenCalledOnce();
    expect(c.applyConsent).toHaveBeenCalledWith('denied');
  });

  it('swallows a throwing client: analytics must never break the app', () => {
    const c = client();
    (c.capture as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('boom');
    });
    setAnalyticsClient(c);
    expect(() => track('signin_clicked', { from: 'nav' })).not.toThrow();
  });
});

const base: ArticleCard = {
  id: 7,
  title: 'T',
  url: 'https://example.com/a',
  sourceId: 's',
  sourceName: 'S',
  publishedAt: '2026-10-01T00:00:00.000Z',
  wordCount: 900,
  difficulty: 2,
  type: 'tutorial',
  quality: 3,
  skills: [
    { id: 'rag', name: 'RAG', isPrimary: false },
    { id: 'evals', name: 'Evals', isPrimary: true },
  ],
};

describe('articleOpenedProps', () => {
  it('uses the primary skill', () => {
    expect(articleOpenedProps(base, 3, 'title', 'for_you')).toEqual({
      article_id: 7,
      skill: 'evals',
      difficulty: 2,
      position: 3,
      via: 'title',
      surface: 'for_you',
    });
  });

  it('falls back to the first skill when none is primary', () => {
    const a = { ...base, skills: [{ id: 'rag', name: 'RAG', isPrimary: false }] };
    expect(articleOpenedProps(a, 1, 'read_button', 'all').skill).toBe('rag');
  });

  it('an article with no skills has skill null', () => {
    expect(articleOpenedProps({ ...base, skills: [] }, 1, 'title', 'all').skill).toBeNull();
  });
});
```

Note: if `type: 'tutorial'` is not a valid `articleTypeSchema` value, `pnpm typecheck` (Step 4) fails on this literal: open `packages/shared/src/api.ts`, take any valid member of `articleTypeSchema`, and use it. The same applies to `difficulty`/`quality` (`levelSchema` range).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @attn/web test -- analytics`
Expected: FAIL, `Cannot find module './analytics'`.

- [ ] **Step 3: Implement `lib/analytics.ts`**

```ts
import type { ArticleCard } from '@attn/shared';
import type { Consent } from './consent';

/** Every custom event and its properties. Adding an event here is the only way to send it: typecheck guards the names. */
export type AnalyticsEvents = {
  signin_clicked: { from: 'landing' | 'nav' };
  onboarding_skipped: { redo: boolean };
  onboarding_completed: { skills_count: number; answered_count: number; redo: boolean };
  feed_viewed: { items_count: number; filtered: boolean };
  article_opened: {
    article_id: number;
    skill: string | null;
    difficulty: number;
    /** 1-based place in the list; on All, within the current page. */
    position: number;
    via: 'title' | 'read_button';
    surface: 'for_you' | 'all';
  };
};

/** What the provider gives us once posthog-js is initialised. Absent (no key, SSR, tests) means every call is a no-op. */
export interface AnalyticsClient {
  capture(event: string, props?: Record<string, unknown>): void;
  identify(id: string): void;
  reset(): void;
  applyConsent(consent: Consent): void;
}

let client: AnalyticsClient | null = null;

export function setAnalyticsClient(next: AnalyticsClient | null): void {
  client = next;
}

function safely(fn: (c: AnalyticsClient) => void): void {
  if (!client) return;
  try {
    fn(client);
  } catch {
    // analytics must never break the app
  }
}

export function track<E extends keyof AnalyticsEvents>(event: E, props: AnalyticsEvents[E]): void {
  safely((c) => c.capture(event, props));
}

export function identify(id: string): void {
  safely((c) => c.identify(id));
}

export function resetAnalytics(): void {
  safely((c) => c.reset());
}

export function setConsent(consent: Consent): void {
  safely((c) => c.applyConsent(consent));
}

export function articleOpenedProps(
  article: ArticleCard,
  position: number,
  via: 'title' | 'read_button',
  surface: 'for_you' | 'all',
): AnalyticsEvents['article_opened'] {
  const skill = article.skills.find((s) => s.isPrimary) ?? article.skills[0];
  return { article_id: article.id, skill: skill?.id ?? null, difficulty: article.difficulty, position, via, surface };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @attn/web test -- analytics && pnpm typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/analytics.ts apps/web/src/lib/analytics.test.ts
git commit -m "feat(web): typed analytics event catalog and no-op safe track()

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Onboarding URL helpers

**Files:**
- Create: `apps/web/src/lib/onboarding-url.ts`
- Test: `apps/web/src/lib/onboarding-url.test.ts`

**Interfaces:**
- Produces:
  - `const QUIZ_PARAM = 'q'`, `const STEP_PARAM = 'step'`
  - `quizIndexFromParam(raw: string | null | undefined, total: number, answered: number): number` (0-based question index for the 1-based `q`; reachable only up to the first unanswered question)
  - `withSearchParam(search: string, key: string, value: string | null): string` (returns `''` or a string starting with `?`; other params kept)

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/onboarding-url.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { quizIndexFromParam, withSearchParam } from './onboarding-url';

describe('quizIndexFromParam', () => {
  it('maps the 1-based param to a 0-based index', () => {
    expect(quizIndexFromParam('1', 5, 0)).toBe(0);
    expect(quizIndexFromParam('3', 5, 2)).toBe(2);
  });

  it('cannot jump past the first unanswered question (reload, Forward, hand-edited URL)', () => {
    expect(quizIndexFromParam('3', 5, 0)).toBe(0);
    expect(quizIndexFromParam('5', 5, 2)).toBe(2);
  });

  it('never goes past the last question', () => {
    expect(quizIndexFromParam('9', 3, 3)).toBe(2);
  });

  it('a bad param clamps to the first question', () => {
    for (const raw of [null, undefined, '', '0', '-1', 'abc', '2.5']) expect(quizIndexFromParam(raw, 5, 4)).toBe(0);
  });

  it('an empty quiz gives 0, not a negative index', () => {
    expect(quizIndexFromParam('1', 0, 0)).toBe(0);
  });
});

describe('withSearchParam', () => {
  it('sets a param and keeps the others', () => {
    expect(withSearchParam('?skills=a,b', 'q', '2')).toBe('?skills=a%2Cb&q=2');
    expect(withSearchParam('', 'step', 'quiz')).toBe('?step=quiz');
  });

  it('replaces an existing value', () => {
    expect(withSearchParam('?step=quiz&q=1', 'q', '3')).toBe('?step=quiz&q=3');
  });

  it('null removes the param; the result is empty when nothing is left', () => {
    expect(withSearchParam('?q=1', 'q', null)).toBe('');
    expect(withSearchParam('?step=quiz&q=1', 'q', null)).toBe('?step=quiz');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @attn/web test -- onboarding-url`
Expected: FAIL, `Cannot find module './onboarding-url'`.

- [ ] **Step 3: Implement `lib/onboarding-url.ts`**

```ts
/** The quiz question in the URL (1-based): `/onboarding?step=quiz&q=2`, `/onboarding/quiz?skills=…&q=2`. */
export const QUIZ_PARAM = 'q';
/** `step=quiz` marks the quiz part of `/onboarding`; the focus step has no param. */
export const STEP_PARAM = 'step';

/**
 * The 0-based question index for a `q` param. A step is reachable only up to the first unanswered question, so
 * a reload, a browser Forward or a hand-edited URL lands on the nearest valid step instead of skipping answers.
 */
export function quizIndexFromParam(raw: string | null | undefined, total: number, answered: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 0;
  return Math.max(0, Math.min(n - 1, answered, total - 1));
}

/** `search` with `key` set (or removed for null), other params kept; `''` or a string starting with `?`. */
export function withSearchParam(search: string, key: string, value: string | null): string {
  const params = new URLSearchParams(search);
  if (value === null) params.delete(key);
  else params.set(key, value);
  const out = params.toString();
  return out ? `?${out}` : '';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @attn/web test -- onboarding-url`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/onboarding-url.ts apps/web/src/lib/onboarding-url.test.ts
git commit -m "feat(web): URL helpers for onboarding steps

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Provider, banner, proxy and wiring

**Files:**
- Create: `apps/web/src/components/analytics-provider.tsx`, `apps/web/src/components/consent-banner.tsx`
- Modify: `apps/web/next.config.ts`, `apps/web/src/app/layout.tsx`, `apps/web/src/components/nav.tsx`, `apps/web/src/components/sign-out-button.tsx`, `apps/web/Dockerfile`, `docker-compose.yml`

**Interfaces:**
- Consumes: `setAnalyticsClient`, `identify`, `resetAnalytics`, `setConsent` (Task 2); `applyConsent`, `readConsent`, `writeConsent`, `resetKeepingConsent`, `browserStorage` (Task 1).
- Produces: `startAnalytics(): void` (idempotent), `AnalyticsProvider({ children })`, `AnalyticsIdentity({ userId })`, `ConsentBanner()`.

This task is glue over tested modules; its checks are typecheck, lint, a production build and a manual request.

- [ ] **Step 1: Write `analytics-provider.tsx`**

```tsx
'use client';

import { Suspense, useEffect, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { identify, setAnalyticsClient, type AnalyticsClient } from '@/lib/analytics';
import { applyConsent, browserStorage, readConsent, resetKeepingConsent } from '@/lib/consent';

/** Inlined at build time. Unset (local dev, CI) means analytics is off. */
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

let started = false;

/** Idempotent: several components call it from their effects, so the order they run in does not matter. */
export function startAnalytics(): void {
  if (started || !KEY || typeof window === 'undefined') return;
  started = true;
  posthog.init(KEY, {
    api_host: '/ingest',
    ui_host: 'https://eu.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: false, // manual, below: the App Router changes the URL without a page load
    capture_pageleave: true,
    // Undecided and declined both count visits cookieless; Accept opts in and starts replay (see lib/consent.ts).
    opt_out_capturing_by_default: true,
    cookieless_mode: 'on_reject',
    disable_session_recording: true,
    session_recording: { maskAllInputs: true },
    loaded: (ph) => applyConsent(ph, readConsent(browserStorage())),
  });
  const client: AnalyticsClient = {
    // send_instantly: sign-in leaves the page right after the click, a batched event would be lost
    capture: (event, props) => void posthog.capture(event, props, { send_instantly: true }),
    identify: (id) => posthog.identify(id),
    reset: () => resetKeepingConsent(posthog, browserStorage()),
    applyConsent: (consent) => applyConsent(posthog, consent),
  };
  setAnalyticsClient(client);
}

/** `$pageview` on every route or query change (onboarding steps are query changes). */
function PageviewTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    startAnalytics();
    if (KEY) posthog.capture('$pageview', { $current_url: window.location.href });
  }, [pathname, search]);
  return null;
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {/* useSearchParams needs a Suspense boundary, or statically rendered pages fail to build. */}
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
      {children}
    </>
  );
}

/** Links the browser to the signed-in user by the internal id only (never email or login). */
export function AnalyticsIdentity({ userId }: { userId: string | null }) {
  useEffect(() => {
    startAnalytics();
    if (userId) identify(userId);
  }, [userId]);
  return null;
}
```

- [ ] **Step 2: Write `consent-banner.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { setConsent } from '@/lib/analytics';
import { browserStorage, readConsent, writeConsent, type Consent } from '@/lib/consent';
import { Button } from '@/components/ui/button';

/** One row at the bottom; shown only with a key set and no stored choice. */
export function ConsentBanner() {
  // 'granted' until the effect reads storage: nothing flashes on the server render or before hydration.
  const [consent, setLocal] = useState<Consent>('granted');
  useEffect(() => setLocal(readConsent(browserStorage())), []);

  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY || consent !== 'pending') return null;

  function choose(value: 'granted' | 'denied') {
    writeConsent(browserStorage(), value);
    setConsent(value);
    setLocal(value);
  }

  return (
    <div
      role="region"
      aria-label="Analytics consent"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-2xl flex-col gap-3 rounded-lg border bg-background p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-muted-foreground">
        We count visits to improve the onboarding. Accept to let us use cookies and record sessions; decline and we
        still count visits, without cookies.
      </p>
      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => choose('denied')}>
          Decline
        </Button>
        <Button type="button" size="sm" onClick={() => choose('granted')}>
          Accept
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the `/ingest` proxy to `next.config.ts`**

Replace the `config` object so it reads:

```ts
const config: NextConfig = {
  transpilePackages: ['@attn/shared'],
  // PostHog asks for this so its /ingest/... paths with trailing slashes are not redirected.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      // Analytics through our own origin: fewer events lost to ad blockers.
      { source: '/ingest/static/:path*', destination: 'https://eu-assets.i.posthog.com/static/:path*' },
      { source: '/ingest/array/:path*', destination: 'https://eu-assets.i.posthog.com/array/:path*' },
      { source: '/ingest/:path*', destination: 'https://eu.i.posthog.com/:path*' },
    ];
  },
};
```

- [ ] **Step 4: Wire layout, nav and sign-out**

In `apps/web/src/app/layout.tsx`: add imports
```tsx
import { AnalyticsProvider } from '@/components/analytics-provider';
import { ConsentBanner } from '@/components/consent-banner';
```
and change the body content to:
```tsx
          <TooltipProvider>
            <AnalyticsProvider>
              <Nav>{children}</Nav>
              <ConsentBanner />
            </AnalyticsProvider>
          </TooltipProvider>
```

In `apps/web/src/components/nav.tsx`: add `import { AnalyticsIdentity } from '@/components/analytics-provider';` and change the return to:
```tsx
  return (
    <>
      <AnalyticsIdentity userId={me?.id ?? null} />
      <AppShell me={me} items={items} defaultOpen={sidebarOpen}>
        {children}
      </AppShell>
    </>
  );
```

In `apps/web/src/components/sign-out-button.tsx`: add `import { resetAnalytics } from '@/lib/analytics';` and call it in `signOut`'s `finally`, before `router.push('/')`:
```tsx
    } finally {
      resetAnalytics();
      router.push('/');
      router.refresh();
    }
```

- [ ] **Step 5: Pass the key through Docker**

`apps/web/Dockerfile`: after the `ENV API_URL=$API_URL` line add
```dockerfile
# Inlined into the browser bundle at build time; empty means analytics is off.
ARG NEXT_PUBLIC_POSTHOG_KEY=
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
```
`docker-compose.yml`, in the `web` service `build.args`:
```yaml
      args:
        API_URL: http://api:3001
        NEXT_PUBLIC_POSTHOG_KEY: ${NEXT_PUBLIC_POSTHOG_KEY:-}
```

- [ ] **Step 6: Verify typecheck, lint and a production build**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @attn/web build`
Expected: all exit 0. If typecheck rejects `cookieless_mode`, `opt_out_capturing_by_default` or `send_instantly`, the option name in `posthog-js` 1.438.12 differs: read `node_modules/posthog-js/dist/module.d.ts` (search the option name), fix the name here, and note it in the commit message; do not drop the option.

- [ ] **Step 7: Manual check against the real project**

Put the project key in `apps/web/.env.local` as `NEXT_PUBLIC_POSTHOG_KEY=phc_...`, run `pnpm api` and `pnpm web`, open http://localhost:3000.
Expected: the consent banner shows; `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/ingest/decide/?v=3` prints `200` or `401`/`400`, never `404`; PostHog → Activity → Live shows a `$pageview` for `/` (cookieless, before Accept). Click Decline: the banner disappears and stays gone after a reload. Remove the key from `.env.local` afterwards only if the owner wants dev quiet.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/analytics-provider.tsx apps/web/src/components/consent-banner.tsx apps/web/next.config.ts apps/web/src/app/layout.tsx apps/web/src/components/nav.tsx apps/web/src/components/sign-out-button.tsx apps/web/Dockerfile docker-compose.yml
git commit -m "feat(web): PostHog provider, consent banner and /ingest proxy

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Onboarding steps in the URL, and its events

**Files:**
- Modify: `apps/web/src/components/onboarding/quiz-runner.tsx`, `apps/web/src/components/onboarding/onboarding-flow.tsx`, `apps/web/src/app/onboarding/page.tsx`

**Interfaces:**
- Consumes: `QUIZ_PARAM`, `STEP_PARAM`, `quizIndexFromParam`, `withSearchParam` (Task 3); `track` (Task 2).
- Produces: `QuizRunner` now calls `onSubmitted(answeredCount: number)`; `OnboardingFlow` takes a new prop `redo: boolean`.

Behaviour to preserve: every animation, the hold timer, focus handling and the two-pick-per-question phase stay untouched. Only where `index` comes from and goes to changes.

- [ ] **Step 1: `QuizRunner`: URL to state, state to URL**

In `quiz-runner.tsx`:

1. Add imports (merge with existing `react`/`next/navigation` imports; `useRouter` is already imported for `QuizRetake`):
```tsx
import { usePathname, useSearchParams } from 'next/navigation';
import { QUIZ_PARAM, quizIndexFromParam, withSearchParam } from '@/lib/onboarding-url';
```
2. Change the prop type and the `submit` success call:
```tsx
  onSubmitted: (answeredCount: number) => void;
```
```tsx
      await browserJson('POST', '/onboarding', profileSchema, focus ? { focus, answers: all } : { answers: all });
      onSubmitted(all.length);
```
3. Inside `QuizRunner`, right after the existing `useState` block (after `const [pending, setPending] = ...` and the `held`/refs declarations, before `useEffect(() => () => {` cleanup), add:
```tsx
  const pathname = usePathname();
  const urlQ = useSearchParams().get(QUIZ_PARAM);

  // The URL leads on browser Back/Forward, reload and hand edits: bring the step state to it, and rewrite a URL
  // that names a step that is not reachable yet. In-app steps push the URL themselves (pick), so they match already.
  useEffect(() => {
    const want = quizIndexFromParam(urlQ, questions.length, answers.length);
    if (want !== index) {
      setAnswers((a) => a.slice(0, want));
      setIndex(want);
      setPhase({ kind: 'first' });
      setHeld(null);
    }
    if (urlQ !== String(want + 1)) {
      window.history.replaceState(null, '', `${pathname}${withSearchParam(window.location.search, QUIZ_PARAM, String(want + 1))}`);
    }
    // only a URL change should re-sync; index and answers move together with the URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);
```
4. In `pick`, where the quiz advances to the next question, push the URL in the same handler. Replace:
```tsx
    if (index + 1 < questions.length) {
      setAnswers(next);
      setIndex(index + 1);
      setPhase({ kind: 'first' });
    } else {
```
with:
```tsx
    if (index + 1 < questions.length) {
      setAnswers(next);
      setIndex(index + 1);
      setPhase({ kind: 'first' });
      window.history.pushState(null, '', `${pathname}${withSearchParam(window.location.search, QUIZ_PARAM, String(index + 2))}`);
    } else {
```
5. In `back`, going to the previous question becomes a browser Back (the effect then moves the state). Replace:
```tsx
    else if (index > 0) {
      setAnswers(answers.slice(0, -1));
      setIndex(index - 1);
      setPhase({ kind: 'first' });
    } else onExit?.();
```
with:
```tsx
    else if (index > 0) window.history.back();
    else onExit?.();
```
6. Retake: `QuizRetake`'s `onSubmitted` ignores the count; no change needed (`() => {...}` is assignable).

- [ ] **Step 2: `OnboardingFlow`: the step param, events, `redo`**

In `onboarding-flow.tsx`:

1. Imports: change the react import to `import { useEffect, useMemo, useState } from 'react';`, change the navigation import to `import { useRouter, useSearchParams } from 'next/navigation';`, and add
```tsx
import { track } from '@/lib/analytics';
import { STEP_PARAM } from '@/lib/onboarding-url';
```
2. Props: add `redo` to the destructuring and the type:
```tsx
export function OnboardingFlow({
  taxonomy,
  role,
  initialFocus,
  redo,
}: {
  taxonomy: Taxonomy;
  role: string;
  initialFocus: string[];
  /** The user was already onboarded: this run is a redo. */
  redo: boolean;
}) {
```
3. After `const skillNames = ...` add:
```tsx
  const inQuiz = useSearchParams().get(STEP_PARAM) === 'quiz';
  // A reload (or Forward) onto ?step=quiz has no questions in memory: go back to the focus step.
  useEffect(() => {
    if (inQuiz && questions === null) window.history.replaceState(null, '', '/onboarding');
  }, [inQuiz, questions]);
```
4. Replace `done()` with two functions:
```tsx
  function leave() {
    router.push('/profile');
    router.refresh();
  }

  function completed(answered: number) {
    track('onboarding_completed', { skills_count: focus.length, answered_count: answered, redo });
    leave();
  }
```
5. `cont`: in the empty-quiz branch call `completed(0)` instead of `done()`, and push the quiz URL after the questions are set:
```tsx
      if (quiz.questions.length === 0) {
        await post([]);
        completed(0);
        return;
      }
      setQuestions(quiz.questions);
      window.history.pushState(null, '', `/onboarding?${STEP_PARAM}=quiz`);
      setBusy(false);
```
6. `skip`: track and leave:
```tsx
  const skip = () =>
    run(async () => {
      await post([]);
      track('onboarding_skipped', { redo });
      leave();
    });
```
7. The quiz render condition and handlers:
```tsx
  if (questions && inQuiz) {
    return (
      <QuizRunner
        questions={questions}
        focus={focus}
        skillNames={skillNames}
        onSubmitted={completed}
        onExit={() => window.history.back()}
      />
    );
  }
```
(`onExit` goes back to the `/onboarding` entry that `cont` left behind; the focus step shows again because `inQuiz` turns false while `questions` stays in memory, and the next Continue refetches them.)

- [ ] **Step 3: Pass `redo` from the page**

In `apps/web/src/app/onboarding/page.tsx` change the `OnboardingFlow` element:
```tsx
      <OnboardingFlow taxonomy={taxonomy} role={profile.role} initialFocus={initialFocus} redo={profile.onboarded} />
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @attn/web test`
Expected: all pass (existing tests unaffected).

Manual (dev server, signed in): open `/onboarding`, pick skills, Continue. Expected: URL becomes `/onboarding?step=quiz&q=1`, then `q=2` after the first question's two picks; the animations are unchanged. Browser Back from `q=2` returns to question 1 with the previous answer gone; Back again returns to the focus step. Reload on `?step=quiz&q=2`: lands on the focus step with the URL `/onboarding`. Open `/onboarding/quiz?skills=<ids>` (retake): the URL gains `&q=1` and keeps `skills`. In PostHog Live events each step shows as a `$pageview` with its `?step=quiz&q=N` URL.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/onboarding/quiz-runner.tsx apps/web/src/components/onboarding/onboarding-flow.tsx apps/web/src/app/onboarding/page.tsx
git commit -m "feat(web): onboarding steps in the URL; skipped and completed events

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sign-in, feed and article events

**Files:**
- Create: `apps/web/src/components/tracked-article-link.tsx`
- Modify: `apps/web/src/components/landing/landing-story.tsx`, `apps/web/src/components/nav-client.tsx`, `apps/web/src/components/feed-list.tsx`, `apps/web/src/components/feed-card.tsx`, `apps/web/src/components/article-card.tsx`, `apps/web/src/app/all/page.tsx`, `apps/web/src/lib/article-links.ts`

**Interfaces:**
- Consumes: `track`, `articleOpenedProps` (Task 2); `articleLinks` from `lib/article-links.ts`.
- Produces: `FeedCard` takes a new prop `position: number`; `ArticleRow` takes a new prop `position: number`; `TrackedArticleLink({ article, position, className, children })`.

- [ ] **Step 1: `signin_clicked` on both sign-in anchors**

`landing-story.tsx`: add `import { track } from '@/lib/analytics';` and change the anchor in `CtaButtons`:
```tsx
          <a href="/api/auth/github" onClick={() => track('signin_clicked', { from: 'landing' })}>
```
`nav-client.tsx`: add `import { track } from '@/lib/analytics';` and change the sidebar anchor:
```tsx
              <a href="/api/auth/github" onClick={() => track('signin_clicked', { from: 'nav' })}>
```

- [ ] **Step 2: `feed_viewed` in `FeedList`**

`feed-list.tsx`: add `import { track } from '@/lib/analytics';`. After the `focusAfter`/`useEffect` that restores focus, add (the page gives `FeedList` a new `key` per filter set, so this runs once per load and per filter change, never on "load more"):
```tsx
  useEffect(() => {
    track('feed_viewed', { items_count: initial.items.length, filtered });
    // once per mount: a new filter set remounts the list (see the key in the for-you page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```
Pass the position to each card in the `items.map`: change `items.map((a) => (` to `items.map((a, i) => (` and the card to:
```tsx
                <FeedCard
                  article={a}
                  position={i + 1}
                  difficultyLabel={difficultyLabels[a.difficulty] ?? `L${a.difficulty}`}
                  onExcluded={excluded}
                />
```
(In dev with React strict mode the effect runs twice; production runs it once.)

- [ ] **Step 3: `article_opened` in `FeedCard`**

`feed-card.tsx`: add `import { articleOpenedProps, track } from '@/lib/analytics';`, add `position: number;` to the props type (with the doc comment `/** 1-based place in the list, for analytics. */`) and to the destructuring. Replace:
```tsx
  const { openLink, readLink } = articleLinks(article.url, () => void send('read'));
```
with:
```tsx
  // Both links count as an opening in analytics (also ctrl/cmd-click and middle click); only the Read button
  // records `read` in the API (owner decision 2026-10-15, lib/article-links.ts). `.readLink` is the variant that
  // carries the click handlers, here also for the title.
  const titleLink = articleLinks(article.url, () => track('article_opened', articleOpenedProps(article, position, 'title', 'for_you'))).readLink;
  const readLink = articleLinks(article.url, () => {
    track('article_opened', articleOpenedProps(article, position, 'read_button', 'for_you'));
    void send('read');
  }).readLink;
```
and in the JSX change the title `<a {...openLink}` to `<a {...titleLink}`. The Read button already spreads `{...readLink}`.

In `lib/article-links.ts` extend the doc comment's first sentence so the next reader does not think the title is unrecorded everywhere: after "...it records nothing (owner decision 2026-10-15)." add " in the API; analytics counts it separately (FeedCard, TrackedArticleLink)."

- [ ] **Step 4: `article_opened` on All**

Create `apps/web/src/components/tracked-article-link.tsx`:
```tsx
'use client';

import type { ReactNode } from 'react';
import type { ArticleCard } from '@attn/shared';
import { articleOpenedProps, track } from '@/lib/analytics';
import { articleLinks } from '@/lib/article-links';

/** The title link of an All row: opens the article and counts it in analytics (click, ctrl/cmd-click, middle click). */
export function TrackedArticleLink({
  article,
  position,
  className,
  children,
}: {
  article: ArticleCard;
  /** 1-based place within the page. */
  position: number;
  className?: string;
  children: ReactNode;
}) {
  const link = articleLinks(article.url, () => track('article_opened', articleOpenedProps(article, position, 'title', 'all'))).readLink;
  return (
    <a {...link} className={className}>
      {children}
    </a>
  );
}
```
`article-card.tsx`: add `import { TrackedArticleLink } from '@/components/tracked-article-link';`, add `position` to `ArticleRow`'s props (`{ article, difficultyLabel, position }: { article: ArticleCard; difficultyLabel: string; position: number }`), and replace the title anchor
```tsx
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="..."
      >
        {article.title}
      </a>
```
with the same classes on the tracked link:
```tsx
      <TrackedArticleLink
        article={article}
        position={position}
        className="col-start-2 row-start-1 line-clamp-2 text-sm leading-snug decoration-2 underline-offset-3 outline-none after:absolute after:inset-0 focus-visible:underline focus-visible:decoration-ring @min-[600px]:order-2 @min-[600px]:col-start-auto @min-[600px]:row-start-auto @min-[600px]:block @min-[600px]:text-ellipsis @min-[600px]:whitespace-nowrap"
      >
        {article.title}
      </TrackedArticleLink>
```
`app/all/page.tsx`: change the map to
```tsx
          {page.items.map((a, i) => (
            <ArticleRow
              key={a.id}
              article={a}
              position={i + 1}
              difficultyLabel={difficultyLabels[a.difficulty] ?? `L${a.difficulty}`}
            />
          ))}
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @attn/web test`
Expected: all pass (the existing `article-links` tests still pass: `articleLinks` itself did not change).

Manual (dev server with the key): click "Sign in with GitHub" on the landing page: PostHog Live shows `signin_clicked` with `from: landing` before the redirect. Open For you: `feed_viewed` with `items_count`. Click an article title and a Read button: two `article_opened` events (`via: title` / `read_button`, `surface: for_you`, `position` 1-based), and Read still removes the card as before. On All: a title click sends `article_opened` with `surface: all`. Ctrl/cmd-click and middle click also send exactly one event; a right click sends none.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/tracked-article-link.tsx apps/web/src/components/landing/landing-story.tsx apps/web/src/components/nav-client.tsx apps/web/src/components/feed-list.tsx apps/web/src/components/feed-card.tsx apps/web/src/components/article-card.tsx apps/web/src/app/all/page.tsx apps/web/src/lib/article-links.ts
git commit -m "feat(web): sign-in, feed view and article-opened analytics events

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, PostHog setup notes, final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document analytics in the README**

Add a short section after "Commands" (match the README's existing heading level and tone):

```markdown
## Analytics (optional)

The site can report visits and the onboarding funnel to PostHog (EU cloud). Set `NEXT_PUBLIC_POSTHOG_KEY` (the
project API key, `phc_...`) in the web's environment; it is inlined at build time, so a Docker build needs it as a
build arg (`docker-compose.yml` reads it from the environment). Without a key there is no analytics and no banner.
Events go through `/ingest` on the site's own origin. A banner asks for consent: until the visitor accepts, visits
are counted without cookies and without session replay; identified users are linked by their internal id only.
The events and their properties are in `apps/web/src/lib/analytics.ts`.
```

- [ ] **Step 2: Full verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @attn/web build`
Expected: all exit 0. If `pnpm test` fails only on tests that need Postgres, start it (`docker compose up -d --wait`) and rerun; report any other failure instead of working around it.

- [ ] **Step 3: One end-to-end pass in PostHog**

With the key set, as a fresh visitor (private window) then signed in: landing → sign in → onboarding (every step) → For you → open an article. In PostHog, create the funnel `$pageview /` → `signin_clicked` → `$pageview /onboarding` → `$pageview ?step=quiz&q=1` … → `onboarding_completed` → `feed_viewed` → `article_opened`, confirm each step appears, then add the owner's user id to Settings → Project → "Filter out internal and test users". Save the funnel and a retention insight (start event `article_opened`, return event `$pageview`, daily) on a dashboard.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: analytics setup in the README

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
