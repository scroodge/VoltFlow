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
