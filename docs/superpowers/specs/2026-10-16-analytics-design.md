# Analytics (PostHog) — design

Date: 2026-10-16. Branch: `feat/analytics`. Status: draft for owner review.

## Purpose

The owner wants to see, from day one and with very few users:

- **A. Engagement:** visitors, users online now, active readers (DAU/WAU/MAU), and where people drop off between the
  landing page and the first article.
- **B. Feed quality:** whether the For you feed gets clicked. The feedback buttons are off the cards
  (`plans/feedback-driven-recommendations.md`), so clicks are the only quality signal.

Success: after launch the owner can open PostHog and read, without further code changes, (1) a funnel
landing → onboarding steps → feed → first article opened, (2) visitors and live users, (3) D1 retention from the first
article opened, (4) feed click-through by position and skill.

**Activation** = the first `article_opened`. **Retention** = D1 (any `$pageview` the day after).

## Decisions (owner-approved in brainstorming)

- PostHog Cloud **EU** (`https://eu.i.posthog.com`), Free plan. Products: Product analytics, Web analytics, Session
  replay (Error tracking is on in the project, unused by this spec).
- Client side only (`posthog-js`), no server-side events. Events go through a same-origin proxy `/ingest/*`
  (Next rewrite) so ad blockers drop fewer of them.
- Consent banner. Accepted: cookies, persistent id, session replay. Declined or undecided: cookieless mode, no replay.
  To verify against the installed `posthog-js` before implementing: whether the undecided state captures cookieless
  or captures nothing; if it captures nothing, the spec changes to treat undecided as declined and the owner is told.
- Identify with the internal user id only (`me.id`); never email or GitHub login. `reset()` on sign out.
- Onboarding steps move into the URL, so `$pageview` is the step event (see below).
- `article_opened` is recorded on the For you feed and on All. Title link and Read button both count.
  Opening a title link still records nothing in the API (owner decision 2026-10-15, `lib/article-links.ts`):
  that decision is about user state, analytics is a separate channel.

## Onboarding steps in the URL

`/onboarding` today is one URL; the focus step and each quiz question are React state. Change: the step is mirrored
in the URL with `history.pushState` (App Router integrates it with `usePathname`/`useSearchParams`):

- `/onboarding` — focus step
- `/onboarding?step=quiz&q=1`, `q=2`, … — quiz questions (1-based)

`OnboardingFlow` and `QuizRunner` keep their state and their animations. The URL is derived from and written by the
step state; browser Back/Forward drive the step through `popstate`. Reloading on a quiz URL returns to the focus
step (answers are not restored). `/onboarding/quiz` (retake) is unchanged except that its questions also move
through `?q=N`. Not in scope: real per-step routes, restoring answers across reloads.

## Events

`$pageview` fires from a provider on every pathname/search change (manual capture; autocapture of pageviews off).

| Event | When | Properties |
|---|---|---|
| `signin_clicked` | landing sign-in button | — |
| `onboarding_skipped` | Skip on the focus step | `redo` |
| `onboarding_completed` | onboarding POST succeeded | `skills_count`, `answered_count`, `redo` |
| `feed_viewed` | For you loaded, and on filter change (not on load more) | `items_count`, `filtered` |
| `article_opened` | click, ctrl/cmd-click or middle click on an article title or Read | `article_id`, `skill`, `difficulty`, `position`, `via` (`title` \| `read_button`), `surface` (`for_you` \| `all`) |

`redo` is true when the user was already onboarded. Funnel for A: `$pageview /` → `signin_clicked` →
`$pageview /onboarding` → `$pageview` quiz q=1 … → `onboarding_completed` → `feed_viewed` → `article_opened`.
Feed CTR (B) = `article_opened` where `surface=for_you` / `feed_viewed` items, broken down by `position` and `skill`.

Live users, visitors, sources: PostHog Web analytics, no code. The owner's own visits are excluded in PostHog
(Settings → filter internal users), no code.

## Components

All new code in `apps/web/src`.

- `lib/analytics.ts` — typed `track(event, props)` over a discriminated event map (misspelled events or wrong
  properties fail `typecheck`); no-op when `NEXT_PUBLIC_POSTHOG_KEY` is unset (local dev, tests) or before init.
- `components/analytics-provider.tsx` — init (`api_host: '/ingest'`, `ui_host: 'https://eu.posthog.com'`, masked
  inputs, replay only on consent), `identify`/`reset` from the `me` that `Nav` already loads, `$pageview` on route change.
- `components/consent-banner.tsx` — one row, two buttons, shadcn styling consistent with the app; choice kept in
  `localStorage`; every storage access wrapped in try/catch.
- `lib/consent.ts` — read/write of the choice, pure and unit-tested.
- Call sites: `signin_clicked` (landing), `onboarding-flow.tsx` + `quiz-runner.tsx` (URL sync, skipped, completed),
  `feed-list.tsx` (`feed_viewed`), `feed-card.tsx` and the All list card (`article_opened`, through
  `articleLinks`' handlers so ctrl/cmd-click and middle click are counted once).
- `next.config.ts` — rewrites `/ingest/static/:path*` → `https://eu-assets.i.posthog.com/static/:path*` and
  `/ingest/:path*` → `https://eu.i.posthog.com/:path*`.
- Env: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` in `.env.example`. These are inlined at build time:
  a Docker build must receive them as build args (to be handled in the plan).

## Error handling

Analytics must never break the app: `track` swallows errors; a blocked or failing PostHog request changes nothing
for the user; the banner and provider render without `localStorage`.

## Testing

- Unit: `lib/analytics.ts` (no-op without a key, no throw, passes event and properties through), `lib/consent.ts`,
  the step ↔ URL mapping (pure functions, including Back/Forward and reload-to-start).
- `typecheck` guards the event catalog.
- Manual: with a real key, click through landing → onboarding → feed → article and see each event in PostHog
  Live events; decline consent and confirm no cookie is set; check the `/ingest` proxy answers.

## Out of scope

Server-side events; restoring onboarding answers on reload; real per-step routes; replacing the stored feedback
events; A/B tests, feature flags, surveys; the privacy-policy page; exporting PostHog data to Postgres.
