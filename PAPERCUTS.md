# Papercuts

Minor workflow friction encountered while working in this repo. Not bugs, not
completed-work logs — see AGENTS.md ("Log papercuts").

## 2026-07-11 09:35 — Claude Fable 5

Investigating trip data via repeated psql/grep Bash calls → the ECC PostToolUse
loop-detection hook fired "Tool 'Bash' called N times with same parameters"
warnings even though every call had different arguments. False positive — it
appears to match on tool name only, not parameters. Also, the stale assertion
in `src/lib/bydmate/hero-drive-metrics.test.mjs` (`formatKmPerPercent` unit
string) made `npm test` baselines noisy until fixed; when a formatter's unit
moves into the UI label, update its test in the same change.

## 2026-07-12 — Claude Sonnet 5

GateGuard's fact-forcing pre-hook demands a fresh 4-fact preamble (importers,
API surface, data schema, verbatim instruction) before literally every first
Bash/Edit/Write call *per file* in a session — including trivial files
(memory notes, i18n string additions, a one-line CHANGELOG entry) and even
re-fires mid-multi-file-edit after context compaction resets its "seen this
file" tracking. Over a long multi-file session this adds a large number of
repeated, low-value preamble turns (hit "denial #13" in one session) for
files where the answer is obviously "none/none/none." Consider scoping the
gate to source code under `src/`/`supabase/` rather than docs/memory/config,
or caching "already answered for this file" across compaction boundaries.

## 2026-07-12 — Codex

Running `npx eslint ... && npm run build` → ESLint completed, but `next build`
stalled after “Creating an optimized production build ...” with no further output
for several minutes; process inspection was blocked by the environment (`ps`
operation not permitted / `pgrep` could not get the process list). The run was
interrupted after the source change had already linted successfully.

## 2026-07-13 19:20 — Sonnet 5

Verifying dashboard modes on `/dev/site/dashboard` → the `DashboardDevToolbar`
(`src/components/dev/dashboard-dev-toolbar.tsx`) keeps the **LIVE** pill visually
highlighted even when another mode is active (PARK/CHARGE/NO DATA highlight *as well*,
so two look selected at once). `aria-pressed` also reports LIVE while the card renders
the other mode. Cosmetic and dev-only, but it makes the toolbar untrustworthy when
checking which fixture is actually applied — cross-check the `?devSnapshot=` query
param instead. Untouched by the status-card work; likely a stale `mode` read or a
class-precedence issue in the pill styling.
