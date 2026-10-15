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

**3. Profile** (`app/profile/page.tsx`, `profile/skill-card.tsx`, `profile/focus-editor.tsx`, `onboarding/sortable-list.tsx`)
- A stats header: skills assessed, focus skills, articles read, like share.
- A section per domain, then a grid of SkillCards. Each SkillCard has:
  - the full LevelMeter coloured by level;
  - a Progress bar of points to the next level;
  - an amber "Uncertain" badge with a Tooltip carrying the existing hint;
  - a primary `#rank` badge;
  - a "Take quiz" link.
- FocusEditor:
  - SortableList rows are restyled (GripVertical handle, icon buttons for up, down and remove);
  - "Add a skill" becomes a Select with groups;
  - Save and Reset buttons.
- Reading history becomes a list with ArticleMeta.

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
