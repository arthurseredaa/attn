# UI redesign with shadcn/ui: design and plan

## Context

This is step 5 of `docs/superpowers/plans/2026-10-15-mvp-v1-finish.md`.

`apps/web` uses Next 16 (App Router), React 19 and Tailwind 4 with a CSS-first theme. There are no shared UI primitives: each component copies its own button, alert and chip class strings, and the UI uses emoji instead of icons. Articles already carry `difficulty` (0–4) and `type`, but the UI never shows them, so useful information gets lost.

The owner wants:
- every page rebuilt with shadcn/ui;
- a design that is unique, structured and clear, where no information gets lost and accent colours are used where they matter;
- dark mode;
- an impressive animation on the landing page.

Work goes one page at a time. The owner checks each page in the browser and approves it before the next one starts.

**Owner decisions (2026-10-15):**
- Style: clean product (Linear-like).
- Dark mode: a light/dark/system toggle.
- Cards show `difficulty` and `type`; `quality` stays internal.
- Page order: For you → All → Profile → Onboarding → Landing.

## Design system

**Base.** shadcn/ui, initialised in `apps/web`:
- style new-york, base colour zinc, CSS variables in OKLCH;
- `tw-animate-css`;
- `lucide-react` icons;
- `cn()` in `src/lib/utils.ts`;
- components in `src/components/ui/`.

**Signature element (what makes it more than stock shadcn): one level colour language.**
- Five tokens, `--level-0` … `--level-4`, form one ramp: emerald → sky → indigo → violet → rose.
- The same ramp colours both the **article difficulty** on cards and **the user's skill level** on the profile, so a reader can match "this article is my level" by colour at a glance.
- A `LevelMeter` component shows 5 segments with N filled in the level colour, plus the label from `taxonomy.levels[n].label`.
  - Article card: compact form.
  - Skill card: full form with a progress bar to the next level.

**Accents. Each colour has exactly one job.**

| Colour | Used for |
|---|---|
| Primary: deep electric indigo (Linear-like, distinctive) | Main CTAs, active nav item, primary skill chip, focus rank |
| `success` (emerald) | Read ✓, like pressed |
| `warning` (amber) | "Uncertain" badge |
| `destructive` | Errors |

Everything else stays neutral zinc, so the accents carry information.

**Typography.**
- The `geist` npm package provides Geist Sans and Geist Mono. The font files are bundled, so builds still work offline (the reason the stage-3 plan chose the system stack).
- Metadata uses Geist Mono, small, uppercase where it fits, with tabular numbers: source · date · minutes.
- Titles use Geist Sans semibold.

**Type badges** are outline badges with a lucide icon:

| Type | Icon |
|---|---|
| release | Tag |
| tutorial | GraduationCap |
| deep_dive | Layers |
| news | Newspaper |
| research | FlaskConical |

**Dark mode.**
- `next-themes` with `attribute="class"`, default `system`.
- `suppressHydrationWarning` on `<html>`.
- `@custom-variant dark`.
- A `ThemeToggle` (Sun/Moon/Monitor) in the nav.

**Motion.**
- `motion` (motion/react) only for the landing animation and small enter/collapse transitions, such as the read card collapsing.
- Everything respects `prefers-reduced-motion`.

**shadcn components everywhere (owner rule).**
- Every hand-rolled control is replaced by its shadcn equivalent, not restyled: buttons and link-buttons (`Button asChild`), inputs, selects, checkboxes, the multi-select (Popover + Command), menus, tooltips, cards, alerts, badges and skeletons.
- Local class-string constants (`btn`, `primary`, `ghostBtn`, `control`, `focusRing`, the copy-pasted alert and chip markup) are deleted in each migrated file.
- Custom components exist only where shadcn has no equivalent (LevelMeter, the sortable list).

**Behaviour stays as is.**
- Logic in `src/lib/*` is untouched (filters, filter-state, query, reorder, article-links, nav-items, api, browser-api, guards).
- Client components keep their state, refs, focus management, aria labels, inflight guards and error handling. Only markup and classes change.
- Error text stays inline per action. No toasts.

## Foundation (ships together with the first page, For you)

1. Create branch `feat/ui-shadcn` in the main checkout, not a worktree, so the `pnpm web` already running in its herdr pane hot-reloads every change for the owner's review.
2. Run `pnpm dlx shadcn@latest init` in `apps/web`. Add: button, card, badge, input, select, popover, command, checkbox, calendar, separator, avatar, dropdown-menu, tooltip, skeleton, progress, alert, empty, toggle.
3. Migrate the legacy tokens **mechanically across all files** in the same commit. The names `muted` and `accent` mean different things in shadcn, so pages that are not migrated yet would break otherwise.

   | Legacy class | New class |
   |---|---|
   | `bg-bg` | `bg-background` |
   | `text-fg` | `text-foreground` |
   | `text-muted` | `text-muted-foreground` |
   | `border-line` | `border-border` |
   | `bg-line` | `bg-border` |
   | `bg-accent` | `bg-primary` |
   | `text-accent-fg` | `text-primary-foreground` |
   | `bg-accent-soft` | `bg-primary/10` |
   | `border-accent` | `border-primary` |
   | `text-red-600` | `text-destructive` |

   Then delete the legacy variables from `globals.css`. Every page keeps rendering correctly before its own redesign.
4. Add `src/components/theme-provider.tsx` and `theme-toggle.tsx`, and wire them in `app/layout.tsx` with the Geist fonts.
5. Add shared app components in `src/components/`:
   - `level-meter.tsx`;
   - `type-badge.tsx`;
   - `skill-chip.tsx`, with the primary chip in the primary colour;
   - `article-meta.tsx` (mono metadata row);
   - `empty-state.tsx` (wraps shadcn Empty).
6. Rebuild the nav (`nav.tsx`, `nav-client.tsx`, `sign-out-button.tsx`):
   - sticky header with a blurred background;
   - links as ghost buttons, the active one shown with the primary indicator;
   - ThemeToggle;
   - Avatar with a DropdownMenu (Profile, Sign out).
   - `HideOnOnboarding` is kept.

## Layout changes (owner, 2026-10-15). These override the sections above where they conflict.

- **Sidebar instead of a top header.**
  - The shadcn `Sidebar` with `collapsible="icon"`: it expands and collapses dynamically, has a Cmd/Ctrl+B shortcut and keeps its state in a cookie.
  - Header: the brand. Content: nav items with icons. Footer: theme toggle and the user menu.
  - On mobile it becomes a Sheet opened from a slim top bar.
  - No sidebar on /onboarding.
- **Full width.** There is no `max-w-4xl` container. Content fills the `SidebarInset`.
- **For you as a grid of tiles.**
  - Desktop shows a responsive grid of cards: 2 columns at md, 3 at xl, 4 at 2xl.
  - Each tile is laid out top to bottom: type + difficulty, title, metadata, skills, then actions pinned to the bottom.
  - Mobile keeps a single-column list.
- **Streaks (future).** A streak widget will go at the top of For you. It is not part of this redesign. The page header just stays easy to extend.

## Visual direction v2 (owner-approved 2026-10-15). This supersedes the look described above.

The first coded For you (indigo, Geist, rounded shadow cards, pill soup, rainbow ramp) was rejected as generic and AI-looking. A round of rich mockup directions was then rejected as overloaded. Research notes are in `2026-10-15-ui-anti-slop-research.md`.

The owner picked:
- **For you:** "Clean tiles". Reference mockup: `ui-mockups/for-you.html`.
- **All:** "Quiet rows". Reference mockup: `ui-mockups/all.html`.

The structure and behaviour sections above still apply (shadcn components everywhere, sidebar, full width, behaviour kept). Anything in them about colours, fonts, badges or the level ramp is replaced by this section.

**Hard rules.**
- Show only real data and existing features. No streaks, "why for you" lines, greetings, stats panels, counts, taglines or explanatory copy. Any text that isn't data or a control label goes.
- Bans:
  - indigo/violet;
  - Inter, Geist, Space Grotesk;
  - shadows;
  - gradients and glows;
  - pill or badge soup;
  - a rainbow level ramp;
  - emoji;
  - tracked uppercase eyebrows.

**Tokens.** shadcn variables, mapped from the mockup.

| Role | Light | Dark |
|---|---|---|
| Page (`--background`) | `#F7F7F4` | `#121211` |
| Tile (`--card`, `--popover`) | `#FFFFFF` | `#191917` |
| Ink (`--foreground`) | `#1B1B18` | `#ECECE6` |
| Muted (`--muted-foreground`) | `#6B6B64` | `#9A9A91` |
| Faint | `#9C9C94` | `#6E6E66` |
| Hairline (`--border`, `--input`) | `#E2E2DC` | `#2B2B28` |
| Empty difficulty segment | `#D6D6CF` | `#3A3A35` |
| Hover (`--accent`, `--muted`) | `#EFEFEA` | `#212120` |
| The one accent (`--primary`, `--ring`) | `#C2410C`, white text | `#FF7A45`, `#121211` text |

- The accent appears only on Read and other primary actions, the primary skill, focus rings and the active nav item.
- Destructive stays red, used only for errors.
- The success and warning colours are kept but used sparingly: success for the "Read" check, warning for "Uncertain".

**Type.**
- Hanken Grotesk for all UI.
- JetBrains Mono only for numbers: dates, minutes and the difficulty label.
- Both load through `next/font/local` from `@fontsource-variable/*` files, which works offline.
- Tabular numbers. Three or four sizes per page.

**Shape.**
- Tiles: 1px border, 8px radius, no shadow.
- Controls: 6px radius.
- Hairline dividers.
- The copied shadcn components in `src/components/ui` are edited at the cva level so the look holds everywhere: no `shadow-*`, no `ring-foreground/10` card ring, and a solid accent focus outline.

**Difficulty** is a 5-segment bar plus its taxonomy label: ink fill on the empty-segment colour. This replaces the coloured LevelMeter ramp.

**Type** is shown as an icon plus a word in plain muted text, not as a badge.

**Skills** show only the primary skill, in accent text, followed by "+N more" in muted text. They are not chips.

**For you tile**, top to bottom:
1. the type, with the difficulty on the right;
2. the title (18px/600, clamped to 3 lines);
3. source · date · minutes;
4. a footer pinned to the bottom, with the primary skill and +N on the left, and the icon actions with tooltips plus a filled Read on the right.

The grid is 3 columns at 1440px, 2 at about 1024px and 1 on mobile, with equal-height rows.

**All row**, on one dense line with hairlines between rows and fixed right-hand columns: type icon, difficulty bars, title, primary skill, source, minutes, date. No grouping headers. On mobile the row wraps to two lines.

## Pages, one per approval cycle

**1. For you** (`app/for-you/page.tsx`, `feed-card.tsx`, `feed-list.tsx`, `filter-bar.tsx`)
- **FeedCard** is a Card. It contains:
  - the title, linked;
  - the ArticleMeta row;
  - skill chips;
  - a compact LevelMeter for difficulty plus a TypeBadge;
  - an actions row: the primary "Read" button with an ↗ icon, then icon+text buttons with `aria-pressed` (ThumbsUp Like, Too easy, Too hard, EyeOff Not interested).
- **Read state:** the card collapses with a motion height animation to a one-line row with a success check, keeping the existing focus logic.
- **FilterBar:**
  - Input with a Search icon;
  - the skills multi-select becomes Popover + Command, with checkboxes grouped by domain;
  - active filters show as Badge chips with an × and "Clear filters".
- **Load more:** an outline Button. EmptyState for the empty cases. A new `app/for-you/loading.tsx` shows card Skeletons.

**2. All** (`app/all/page.tsx`, `article-card.tsx`)
- Reuses the card layout from For you, read-only with no actions.
- FilterBar extras: source becomes a Select; the date range becomes a Popover with a range Calendar. The mapping to the existing `from`/`to` strings in `filter-state` is unchanged.
- Cursor paging links as Buttons. Inline Alert for the 400 error. `loading.tsx`.

**3. Profile** (`app/profile/page.tsx`, `layout.tsx`, `loading.tsx`, `profile/profile-radar.tsx`, `profile/skill-row.tsx`, `profile/focus-editor.tsx`, `onboarding/sortable-list.tsx`, `lib/skill-value.ts`). Built in the v2 quiet style; no stats header, no coloured level ramp, no badges.
- **Header:** "Profile" left; on the right, the quiz link for unquizzed skills (existing `quizAllLabel` / `QUIZ_LINK_CAP`) and "Redo onboarding", both outline Buttons.
- **Two radar charts** (shadcn Chart over Recharts `RadarChart`, polygon grid rings at 1–4 on a 0–4 scale), side by side on desktop (up to 380px square each), stacked on mobile, each under a small plain heading:
  - **Domains:** a hexagon, one axis per domain. Value = mean over its skills of `(level ?? 1) + min(points / pointsNeeded, 0.99)`, capped at 4. Ink stroke, light ink fill. Axis labels link to the domain's section below (`#domain-<id>`); domains holding a focus skill have their label in the accent.
  - **Focus:** one axis per focus skill in rank order, same value, accent stroke and fill. Shown only with 3 or more focus skills; otherwise the domains chart stands alone.
  - Tooltip (ink chip) on hover or keyboard focus of a vertex: name, taxonomy level label, value in mono. A visually hidden table carries the same values. The draw animation is off under reduced motion.
- **Focus skills** (FocusEditor + SortableList): hairline rows with a GripVertical handle, the rank as accent mono `#n`, and ghost icon buttons (ArrowUp, ArrowDown, X) with tooltips and the existing aria-labels and focus handling. "Add a skill" is a Select grouped by domain. Reset (outline) and Save focus (primary).
- **Skills by domain:** a section per domain (`id="domain-<id>"`), h2 plus "Take quiz for this domain" when applicable. Skills are quiet rows like All: name (description as title) with the focus rank in accent mono, the 5-segment LevelMeter plus the level label in mono or "Not assessed", `points/pointsNeeded` or "Max" in mono, "Uncertain" in warning text with the existing hint as a Tooltip (only for assessed skills; unassessed ones already read "Not assessed"), and "Take quiz" for unquizzed skills. Container queries; two lines on mobile.
- **Reading history:** quiet rows (title link in a new tab, source, read date in mono); "Nothing read yet" when empty. The like share sits beside the heading as `Liked 40% · 4 of 10`, omitted when nothing was read.
- The guard runs in `app/profile/layout.tsx`, so `loading.tsx` skeletons keep the signed-out 307.

**4. Onboarding** (`onboarding/*.tsx`, `app/onboarding/**/page.tsx`)
- A step indicator: 1 Focus → 2 Quiz.
- FocusPicker: skill pills become Toggle buttons with a counter against `MAX_FOCUS`.
- QuizRunner: a Progress bar for the question count. Options are large selectable cards (`role=radio` semantics kept as they are). Back and Retry buttons.

**5. Landing** (`app/page.tsx`, `error.tsx`, `not-found.tsx`)
- Hero with an impressive animation in motion/react, made to explain the product rather than generic decoration.
  - **Proposed concept:** a stream of raw article cards flows in. Each one gets labelled (skill chips and a difficulty LevelMeter "scan" in), then they sort into a ranked "For you" column matched to the reader's level colour.
  - Alternative: an animated level-ramp aurora or grid background.
  - "Obsidian UI" could not be found. If a reference link turns up, borrow from it. MIT-licensed shadcn-registry options are Magic UI and Animate UI.
  - The concept is confirmed with the owner at the start of this step.
  - Reduced-motion fallback: a static composed frame.
- Three step cards with icons.
- CTAs: GitHub sign in or Open ATTN; Browse all.
- The `auth_error` message becomes an Alert.
- `error.tsx` and `not-found.tsx` become EmptyState.

## Execution per page

1. A subagent implements the page on `feat/ui-shadcn` (orchestrator role), with one commit per page.
2. Gate: `pnpm lint && pnpm typecheck && pnpm test`, and `pnpm --filter @attn/web build`.
3. The orchestrator checks the page with claude-in-chrome:
   - screenshots in light and dark, at desktop and 390 px mobile width;
   - every interaction on the page clicked through (filters, Read, feedback, load more, back/forward);
   - the console checked for errors.
4. The owner reviews at localhost:3000 and either approves or sends a fix list. Only then does the next page start.
5. After Landing is approved: a final code review, then merge `feat/ui-shadcn` into main locally (owner's OK), and tick step 5 in the MVP finish plan.

Before page 1, this design is saved as `docs/superpowers/specs/2026-10-15-ui-shadcn-design.md`, and the per-page plan as `docs/superpowers/plans/2026-10-15-ui-shadcn.md`.

## Verification

- The gate above passes on every commit. The existing web unit tests (`lib/*.test.ts`) still pass unchanged.
- The browser check covers every page in light, dark and system mode, with the theme toggle persisting across reloads.
- Keyboard-only pass:
  - focus stays on the card after Read;
  - focus moves correctly after not_interested and in the sortable list;
  - focus rings are visible.
- Reduced-motion check on the landing page and the read collapse.
