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
