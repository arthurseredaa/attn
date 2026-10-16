---
paths:
  - apps/web/**
---

# Web (Next.js app router, shadcn, Tailwind v4)

The visual direction is owner-approved and strict. Full spec: `docs/superpowers/specs/2026-10-15-ui-shadcn-design.md`
("Visual direction v2" overrides older sections).

- Show only real data and existing features. No greetings, taglines, stats, counts, "why for you" lines or other
  explanatory copy.
- Banned: indigo/violet, Inter/Geist/Space Grotesk, shadows, gradients and glows, pill or badge soup, a rainbow level
  ramp, emoji, tracked uppercase eyebrows.
- One accent (`--primary`, #C2410C light / #FF7A45 dark), only on primary actions, the primary skill, focus rings
  and the active nav item. Warm neutral tokens live in `src/app/globals.css`.
- Hanken Grotesk for UI; JetBrains Mono only for numbers (dates, minutes, difficulty label), with tabular numbers.
- Tiles: 1px border, 8px radius, no shadow. Controls: 6px radius.
- Use the shadcn components in `src/components/ui`. Change their look at the cva level there, not per call site.
- Keep hover quiet (a tint or small accent); save expressive motion for the actual pick or action.
- Before changing a page layout, show the owner an ASCII preview and wait for approval.

Data access:
- Server components use `src/lib/api.ts` (calls `API_URL` directly, forwards cookies). Client components use
  `src/lib/browser-api.ts` (goes through the `/api/*` rewrite). Never import `api.ts` from a client component.
- Parse every API response with the zod schemas from `@attn/shared`.
