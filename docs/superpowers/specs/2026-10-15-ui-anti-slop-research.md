# UI research: avoiding the "AI-generated" look (2026-10-15)

The owner rejected the first shadcn version of For you as generic and AI-looking. This file summarises three research passes:
- tells and antidotes;
- reference products;
- a shadcn re-skinning toolkit.

The chosen direction will be recorded in `2026-10-15-ui-shadcn-design.md`.

## Tells the first version had

- An indigo/violet primary (`oklch(0.51 0.23 277)`).
- Untouched shadcn defaults: zinc, radius `0.625rem`, `rounded-xl shadow-xs ring-1` cards.
- Geist as the only typeface, so headings and body look the same.
- A grid of identical rounded cards.
- Pill soup: type, difficulty and skills all shown as badges.
- A rainbow level ramp built from Tailwind hues.
- Lucide icons on every item, mono uppercase meta strings and "·" separators.

## Antidotes, ranked by impact

1. Pick one deliberate signal colour. Use it in large flat areas with meaning, not as small accents scattered everywhere.
2. Use contrasting type roles, e.g. a serif for titles, a sans for the UI and a mono for data. Make the scale jumps big.
   - Avoid Inter, Geist, Space Grotesk and Instrument Serif; they are the convergence picks.
   - Cream background + serif + terracotta accent is the 2026 "tasteful" cliché. Avoid it too.
3. Use hairline rules instead of cards, square or near-square corners, and borders instead of blurred shadows.
4. Encode type, difficulty and skills in typography and layout instead of badges.
5. Make one bold signature element and keep everything else disciplined. Use one orchestrated motion moment, not hover effects everywhere.
6. Treat copy as design: sentence case, specific claims, no "→" or eyebrow clutter.

## Toolkit

- **shadcn styles.**
  - Lyra: zero radius, boxy, mono-friendly.
  - Mira: the densest style.
  - Switch with `npx shadcn@latest apply --preset <code>`. Commit first, because it reinstalls components.
- **tweakcn** for prototyping tokens.
- **Huetone, Harmonizer and Leonardo** for checking OKLCH ramps.
- **Systemic overrides.**
  - Tokens in `@theme inline`: radius, shadows, fonts, tracking.
  - Edit the cva strings of the copied components in `src/components/ui`.
  - Use `data-slot` selectors only for rules that must hold everywhere.
- **Fonts.**
  - OFL fonts from `@fontsource-variable/*` loaded through `next/font/local`, which works offline: IBM Plex Sans and Plex Mono, Newsreader, Source Serif 4, Schibsted Grotesk, Bricolage Grotesque, JetBrains Mono, Martian Mono, Commit Mono.
  - Fontshare fonts (ITF licence) must not be committed to a public repo.
  - Pangram Pangram free fonts are personal-use only, so rule them out.

## References worth stealing from

| Reference | What to take |
|---|---|
| Zed blog | Plex Serif and mono; a list archive with dotted leaders to mono dates |
| Techmeme, Lobste.rs | Dense metadata without boxes |
| Increment | A ruled metadata box with spaced uppercase labels |
| Stripe Press | Spine colours |
| Fly.io blog | Serif headlines with a mono byline |
| Every | `#skill` tabs |
| Exercism | Concept tiles like chemical elements, with progress dots |
| Are.na | Outlined square tiles |
| Things 3 | Progress pies |
| Duolingo | Streak milestones celebrated, not just counted |
| Linear | See below |

From Linear, the owner's favourite, take this for **All**:
- grouped rows with counts;
- signal-bar priority, used for difficulty here;
- right-aligned tags with coloured dots and dates;
- a right-hand details panel.

**For you** must be more expressive than All.

## Sources

- https://www.claude.com/blog/improving-frontend-design-through-skills
- https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- https://www.adriankrebs.ch/blog/design-slop/
- https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website
- https://claudecodehq.com/playbooks/unslop-ui
- https://www.superdesign.dev/blog/why-ai-design-looks-generic
- https://ui.shadcn.com/docs/changelog/2025-12-shadcn-create
- https://ui.shadcn.com/docs/changelog/2026-04-shadcn-apply
- https://linear.app/now/how-we-redesigned-the-linear-ui
- https://blog.duolingo.com/streak-milestone-design-animation/
