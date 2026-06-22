# Little Shelf Agent Notes

## Product Direction

Little Shelf is a mobile-first PWA reading companion for a private, personal book library.

It is not a Goodreads clone. Do not optimize for social features, public reviews, feeds, discovery graphs, or database-like collection management. The app should feel like a quiet reading diary plus a mood-based book picker.

The core jobs are:

- Help someone decide what to read next.
- Track what they are currently reading.
- Remember how finished books felt.
- Keep the experience private, calm, and personal.

The first screen should always feel like the app itself, not a marketing page.

## Current Stack

- TanStack app / TanStack Start
- React + TypeScript
- Tailwind CSS
- Biome
- `lucide-react` icons
- Local-first MVP storage with `localStorage`
- No backend, auth, sync, or public accounts yet

## Current App Shape

The app lives primarily in:

- `src/components/LittleShelfApp.tsx`
- `src/components/bookData.ts`
- `src/routes/index.tsx`
- `src/styles.css`

Main navigation uses thumb-friendly mobile bottom tabs:

- `Now`
- `Shelf`
- `Pick`
- `Journal`

Current primary flows:

- Add a book manually.
- Edit a book.
- Delete a book.
- Change status.
- Track current-page progress.
- Pick a recommendation from `want` or `paused` books.
- Add/edit reflection fields for finished books.
- Persist books to `localStorage`.
- Start empty when there is no saved local data.

## Data Model

A book should have:

- `id`
- `title`
- `author`
- optional `coverUrl`
- optional `coverColor`
- `status`: `want | reading | finished | paused`
- `moodTags`: `cozy | sad | romantic | smart | weird | easy | heavy | short | hopeful | dark | funny | beautiful`
- optional `progress`: `currentPage`, `totalPages`
- `addedAt`
- optional `startedAt`
- optional `finishedAt`
- optional `rating`
- optional `reflection`: `feeling`, `quote`, `note`, `wouldReread`, optional `giveTo`

Keep the model simple until there is a concrete need for more structure.

## Design Direction

The visual language should be:

- Clean
- Calm
- Personal
- Polished
- Mobile-first
- Thumb-friendly
- More diary than dashboard
- Easy to understand at a glance

Use a restrained palette:

- Quiet paper-like background
- Deep ink text
- One muted accent per theme
- Book-like cover colors

Current UI priority: improve the visual system before adding more product features. The app should not feel clunky, crowded, or confusing. Prioritize typography, spacing, hierarchy, layout consistency, and flow clarity before export/import, search, or other roadmap features.

Themes are allowed if they remain calm and readable. Theme work should change the mood of the app without making it decorative or busy.

Avoid:

- Marketing hero sections
- Generic database rows
- Nested cards
- Desktop dashboard layouts squeezed onto mobile
- Social-network affordances
- Overly technical form controls in the main flow

Cards should generally represent individual books or modal/sheet surfaces only.

## Product Principles

- Feelings matter more than metrics.
- Choosing the next book should feel low-pressure.
- Finished books should become memories, not just completed rows.
- The shelf should feel private and lived-in.
- Adding a book should be quick.
- Editing details should be available, but not visually dominant.
- Local-first means the user owns the data, but MVP data loss risk must be handled with export/import.

## Near-Term Roadmap

Recommended next steps, roughly in priority order:

1. Improve the UI system: typography, spacing, layout consistency, theme tokens, and overall clarity.
2. Replace the technical cover-color dropdown with named color swatches.
3. Improve Pick copy and recommendation reasoning so it sounds more human and mood-aware.
4. Support multiple current reads on the Now screen instead of only showing the first `reading` book.
5. Add Shelf search and lightweight filters for status and mood.
6. Add a finish-book reflection prompt when a book is marked `finished`.
7. Remove or repurpose starter leftovers like unused header/footer/about components.
8. Gate or remove devtools from the normal user-facing shell.
9. Add real PWA polish: app icon, install metadata, and offline caching/service worker if needed.
10. Add JSON export/import backup much later. It matters eventually, but it should not drive the current product work.

## Implementation Preferences

- Prefer small, direct changes over broad rewrites.
- Keep state management simple while local-only.
- Do not add backend/auth/sync unless explicitly requested.
- Do not introduce complex libraries for forms or state unless the app clearly needs them.
- Keep TypeScript types clear and close to the feature code.
- Preserve mobile-first behavior first; desktop is secondary.
- Run `npm run check` after changes.
- Run `npm run build` after meaningful app changes.

## Current Best First Task

The best next implementation task is a UI refinement pass.

Reason:

- The current app works, but feels clunky.
- The next phase should make the app feel clean, minimal, consistent, and easy to use.
- Visual polish should come before more features.

Suggested scope:

- Change the font system.
- Tighten spacing and layout rhythm.
- Make cards, sheets, fields, and nav feel consistent.
- Add calm themes.
- Keep existing data behavior intact.
- Avoid large feature additions during this pass.
