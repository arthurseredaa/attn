# SEO and AI-search visibility

Status: plan, not started. Written 2026-10-16. Research with sources: `docs/research/2026-10-16-seo.md`.
Depends on: a domain and hosting (deferred in `docs/decisions.md`), and the PostHog analytics work
(`docs/superpowers/specs/2026-10-16-analytics-design.md`) for the traffic side of tracking.

## The problem in one paragraph

Search engines rank pages for the content on them. ATTN has no articles of its own: a card is a title, a source,
skill labels, a difficulty level and a link out. Google's spam policy names this exact shape as a risk:
"Reproducing content feeds from other sites without providing some type of unique benefit to the user". So ATTN
cannot win by indexing many pages (one per article, one per filter combination). That would read as a feed mirror
and could pull down the whole domain (Mueller, 2026-09: low-value programmatic pages make Google "lose faith in
your site"). ATTN can win only with **a small set of pages that are better than any single article for a learning
query**. That set is the skill hubs.

## How search works here (for a non-SEO reader)

1. **Discover.** Google finds URLs through links and the sitemap.
2. **Crawl.** Googlebot fetches the page. robots.txt says what it may fetch.
3. **Index.** Google decides whether the page is worth storing. This is where thin pages die, as "Crawled –
   currently not indexed" in Search Console. `noindex` tells Google not to store a page.
4. **Rank.** For a query, Google orders indexed pages by relevance and quality.

AI answers (Google AI Overviews, AI Mode, ChatGPT search, Copilot, Perplexity) sit on top of the same indexes:
- Google's AI features use Google's index.
- Copilot and DuckDuckGo use Bing's index, and ChatGPT search probably does too.
- No special files or markup are needed. llms.txt is ignored by Google.

Being indexed in Google **and** Bing is the whole of "GEO" for a site this size.

## Strategy

**Index few pages, make each one worth it.**

| Page | Indexed | Why |
| --- | --- | --- |
| `/` landing | yes | brand queries ("attn ai articles"), site name and logo in results |
| `/skills` (new) | yes | the skill map: every skill by domain, with counts; the internal-link hub |
| `/skills/<id>` (new) | only when it passes the gate below | the pages that can rank for non-brand queries |
| `/about` (new) | yes | how ATTN picks and labels articles; trust, and Google's "How was this created?" guidance |
| `/all` unfiltered | yes | the newest-first list; low ranking value, but a stable entry point |
| `/all?…` any param | no (`noindex, follow`) | filter combinations are "closer to search results" (doorway policy) |
| `?q=` search | blocked in robots.txt | Google: keep site-search pages out |
| `/for-you`, `/profile`, `/onboarding*` | blocked + `noindex` | private; anonymous visitors get a 307 to `/` anyway |
| `/api/*` | blocked | JSON and the OAuth start; the landing links to `/api/auth/github` |
| per-article pages | never created | thin, compete with the original, and LLM summaries break the curation-only rule |
| `/sources/<id>` | not built for now | it would mirror the source's own blog index: no added value |

### The skill hub: what makes it more than a link list

A hub answers "how do I learn <skill>, in what order". No single source answers that: Anthropic's blog does not
order Simon Willison's posts by level, and neither does anyone else. Contents of `/skills/<id>`:

1. An H1 with the skill name, its domain, and "N articles, updated <date>".
2. **An owner-written intro**, 2–4 sentences: what the skill is, why it matters, where to start. It is human
   curation, not generated content, so it fits the project rule. It lives in a new `data/hubs.yml` (skill id →
   `intro`), validated by a zod schema in `packages/shared`. It is not stored in `taxonomy.yml`, because
   taxonomy descriptions feed the labeling prompt and their wording is tuned for the model, not for readers.
3. **A learning path**: articles grouped by difficulty (Start here: 0–1, Regular practice: 2, Advanced: 3–4).
   Each group lists tutorials and deep dives first, then the rest. Labels come from the existing taxonomy level
   names.
4. **Latest releases and news** for the skill, limited to `fresh_days`, kept separate so the path stays evergreen.
5. **Related skills** in the same domain, as links to their hubs.
6. A sign-in call to action: "Get this ranked for your level". The hub is the SEO entry point into the product.

Membership: an article belongs to a hub when the skill is its primary or a secondary skill (the same any-match as
`/api/articles?skill=`). Primary-skill articles sort first within each group.

### The index gate

A hub is indexable only when **both** of these hold:
- it has at least `seo.min_hub_items` labeled articles (`data/config.yml`, start at 8);
- it has an owner intro in `data/hubs.yml`.

Otherwise it is served with `noindex, follow` and left out of the sitemap. An unknown skill id gets a real 404 (the
check runs in `app/skills/[id]/layout.tsx`, outside `loading.tsx`, the same pattern as `for-you/layout.tsx`).

Today's data, 301 labeled articles counted as primary or secondary: 22 skills have ≥8 articles and 26 have ≥5.
So the first launch would index about 20 hubs plus 4 static pages. That is enough to start, and growth is
controlled: a hub enters the index when the owner writes its intro.

## Implementation phases

Each phase becomes its own implementation plan in `docs/superpowers/plans/` when it is picked up.

### Phase 0: prerequisites (owner)

- Choose a domain. The TLD has no SEO effect (.ai, .dev and .com are all treated as generic), so pick for memory
  and renewal price. Choose apex or www, 301 the other, and serve HTTPS only.
- Deploy somewhere public. Server location does not matter for a global English site.

### Phase 1: index hygiene (small, do first)

- `SITE_URL` in `.env.example`, and `apps/web/src/lib/site.ts`.
- Root `layout.tsx`:
  - `metadataBase`;
  - `title: { default: 'ATTN: AI articles by skill and level', template: '%s | ATTN' }`;
  - default description;
  - `openGraph.siteName`;
  - `twitter.card`.
- `app/robots.ts`:
  - disallow `/api/`, `/for-you`, `/profile`, `/onboarding`, `/*?*q=`;
  - add a `Sitemap:` line;
  - explicitly allow `OAI-SearchBot`, `PerplexityBot`, `Claude-SearchBot`;
  - training bots (`GPTBot`, `Google-Extended`, `ClaudeBot`) are an owner decision (see Open questions).
- `noindex` metadata on the auth-only layouts.
- `/all`: switch from static `metadata` to `generateMetadata`:
  - no params → self-canonical;
  - any param → `noindex, follow`, with a canonical to `/skills/<id>` when the only filter is one skill, else to
    `/all`.
- `app/sitemap.ts`: `/`, `/skills`, `/about`, `/all` and the indexable hubs. `lastModified` is the newest article in
  each hub (needs a small API addition: per-skill counts and newest `published_at`). No external URLs.
- Check: are canonical tags in `<head>` for Googlebot? Next 16 streams metadata into `<body>` on dynamic pages,
  every ATTN page is dynamic (Nav reads cookies), and Google requires the canonical in `<head>`.
  - Check with `curl -A Googlebot` and then Search Console URL Inspection.
  - If it fails, set `htmlLimitedBots` to the default regex plus `|Googlebot`.

### Phase 2: hubs and the skill map

- `data/hubs.yml` and its zod schema (contract first, in `packages/shared`). The loader rejects unknown skill ids.
- API: `GET /api/skills/:id/hub` (articles grouped for the page, counts, newest date) and per-skill counts for
  `/skills` and the sitemap.
- Web: `/skills`, `/skills/[id]`, `/about`.
- Skill names on article rows (All, For you) and on the landing page become `<a href="/skills/<id>">` links. This
  is internal linking: it is how Google finds the hubs and judges which ones matter.
- Owner task: write intros for the ~20 hubs that pass the count threshold, about an hour in total.

### Phase 3: presentation in results

- JSON-LD through a small `JsonLd` server component that escapes `<` (article titles come from external feeds):
  - `WebSite` + `Organization` on `/`;
  - `BreadcrumbList` on hubs (Home › Skills › <skill>).
  - No ItemList or carousel: Google's carousel needs list items on ATTN's own domain.
- `app/icon.png` (≥112×112, reused as the Organization logo) and `app/opengraph-image.tsx`, plus a per-hub OG image.
  These need a `.ttf` font, because `next/og` cannot use the woff2 files.
- Per-hub `title` ("<Skill>: articles from beginner to advanced") and `description` taken from the intro.

### Phase 4: tell the search engines

- **Google Search Console**:
  1. Add a Domain property and verify it with a DNS TXT record. Keep the record forever.
  2. Submit `/sitemap.xml`.
  3. Inspect `/` and request indexing.
  4. Add an annotation "launch".
- **Bing Webmaster Tools**: My Sites → Import from GSC (one step, no separate verification).
- **IndexNow**:
  - put a key file in `apps/web/public/<key>.txt`, with `INDEXNOW_KEY` in env;
  - after the daily collect+label job (`apps/api`), POST the hub URLs whose article set changed, plus `/` and
    `/all`;
  - production only; never external URLs.
  - It reaches Bing, so Copilot, DuckDuckGo and probably ChatGPT see new hubs within hours instead of weeks.
    Google does not take part and relies on the sitemap's `lastmod`.

### Phase 5: launch distribution (not SEO, but SEO depends on it)

Google finds most new pages through links. Comparable sites (TLDR, Hacker News, daily.dev) get most of their search
traffic from people typing their name. So:
- launch posts: Show HN, relevant subreddits, AI-engineering newsletters;
- a link from the GitHub README.

These links are nofollow, so they pass no ranking value. What they do bring: discovery, first visitors, brand
searches, and the chance that a blog or newsletter writes a real editorial link. Ongoing, hub pages are shareable
answers to "where do I learn X".

## Why this should work, and the limits

- **It matches what Google rewards.** A hub shows original selection, ordering and owner context that does not exist
  elsewhere. That is the "unique benefit" the spam policy asks for. roadmap.sh ranks for non-brand terms ("full
  stack developer" #1) with the same idea: topic pages with an original learning structure.
- **The queries are winnable.** Long-tail learning queries ("claude code hooks tutorial", "learn rag evaluation",
  "prompt caching examples") have few strong answers, and a curated, level-ordered list beats a random single post
  for a learner. AI answers also cite "best resources for X" lists often (vendor studies, 2026, low confidence).
- **It keeps the domain safe.** Index growth is gated by real content (count + intro). Filters, search, cursors
  and private pages stay out, so nothing feeds the "lost faith" site-wide signal.
- **Limits, stated plainly:**
  - SEO will be a secondary, slow channel.
  - Expect hubs indexed in 1–2 weeks after launch, first non-brand clicks in 1–3 months, meaningful search traffic
    in 6–12+ months, or never if Google judges the hubs too thin.
  - AI citations bring visibility more than clicks (Pew 2025: people click less when an AI summary shows).
  - The main channel is distribution (Phase 5).

## Tracking

The setup is free; no paid tool is needed until there is real traffic.

| Tool | Answers | Look at |
| --- | --- | --- |
| Google Search Console | Is Google indexing and showing us, for which queries? | Page indexing (indexed vs submitted, "Crawled – currently not indexed"), Performance (impressions, clicks, CTR, position by query and page), Generative AI report (AI Overviews/AI Mode impressions; already inside Web totals, do not add) |
| Bing Webmaster Tools | Same for Bing, plus AI citations | Search performance, **AI Performance** (Copilot/Bing AI citations, grounding queries), IndexNow receipts |
| PostHog web analytics | Who arrives, from where, does it lead to use | Channel types *Organic Search* and the built-in *AI* (chatgpt.com, perplexity.ai, claude.ai, gemini, Copilot); entry pages; the funnel landing → sign-in → onboarding completed → first `article_opened` broken down by channel |
| PostHog GSC source (optional) | Search Console data next to product data, kept past GSC's 16 months | `by_date`, `by_page`, `by_query` tables |
| Ahrefs Webmaster Tools, Screaming Frog (free) | Technical errors and backlinks | One audit before launch, then monthly |
| PageSpeed Insights | Core Web Vitals | LCP ≤2.5 s, INP <200 ms, CLS <0.1; lab numbers first, field data needs traffic |

People who decline cookies are counted without a persistent id. Count search and AI visits by the session channel
type, not by person properties.

**Leading signals** (weeks 1–8):
- the share of sitemap URLs that are indexed;
- impressions;
- the number of distinct queries;
- the first Bing AI citations.

**Lagging signals** (month 3+):
- non-brand clicks;
- CTR on hub pages;
- activation rate of organic and AI visitors.

**Cadence:**
- Weekly, 15 minutes: GSC Page indexing and Performance (28 days vs the previous 28), PostHog channels.
- Monthly:
  - in GSC, find pages with high impressions and low CTR and rewrite their title and description;
  - check the Bing AI report;
  - rerun the audit;
  - look at the funnel by channel.
- Annotate every notable change in GSC.

**The early warning:** many hubs stuck in "Crawled – currently not indexed" means Google finds them thin. Then
make the intros richer and raise `seo.min_hub_items`. Do not add more pages.

## Deliberately not doing

- Per-article pages, LLM summaries, auto-generated hub text.
- Indexable filter or level combinations (`/skills/<id>/level/<n>`) or source hubs.
- llms.txt (Google ignores it; it costs nothing, so it can be added later for other AI tools).
- Routing outbound clicks through a redirect. Links stay plain `href`s; analytics is client-side.
- Paid SEO or LLM-citation trackers.

## Open questions for the owner

1. Domain and hosting (Phase 0).
2. Who writes hub intros, and is "≥8 articles + an intro" the right gate?
3. AI training crawlers (`GPTBot`, `Google-Extended`, `ClaudeBot`): allow or block? Blocking them does not affect
   ChatGPT search, Google AI Overviews or Claude search; those use the separate search bots.
4. Drop `noreferrer` from outbound links, so publishers see ATTN in their referral reports? It is not an SEO
   factor, but it builds the relationships that lead to backlinks.
5. Should the landing page link to the top hubs (a "Browse by skill" block)? It is the strongest internal link on
   the site.
