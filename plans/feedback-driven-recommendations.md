# Feedback-driven recommendations

Status: idea. Noted 2026-10-16.

## Why

The feedback buttons on the For you cards (Like, Too easy, Too hard, Not interested) promise more than they
deliver, so they are being taken off the cards for now. They should come back only together with a real mechanism
that adapts recommendations to what the reader does.

## What exists today

- `like`: recorded, nothing reads it.
- `not_interested`: hides the article and lowers the skill's `interest` (decay with a floor).
- `too_easy` / `too_hard`: shift the skill's difficulty target by at most ±1; only events newer than the
  latest quiz answer for that skill count.
- `read`: hides the article and adds level points.

Code: `packages/core/src/levels/events.ts`, `packages/core/src/rank/sql.ts`.

## To work out

- Which signals count: likes and dislikes, too easy/hard, reads, skips, opens without a read, time spent.
- How each one changes ranking: skill interest, difficulty target, source or type preferences.
- Decay over time, and how strongly one click moves things.
- Whether the reader can see why an article was recommended, and undo a signal.
- How to test it (offline replays of events, eval-style checks).
- What the buttons look like when they return.
