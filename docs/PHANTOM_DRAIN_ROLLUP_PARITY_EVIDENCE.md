# Phantom Drain rollup parity evidence

Production evidence recorded **2026-09-10**. No raw telemetry, coordinates, user IDs,
or SOC values are retained in this document.

## Proof gate

- The committed rolled-back fixture `supabase/tests/phantom_drain_daily_rollup_parity.sql`
  passed: zero raw/rollup mismatch rows, including multiple intervals, UTC midnight,
  six-hour boundaries, invalid SOC parsing, no-eligible cleanup, and parked-predicate
  cases.
- A rolled-back production proof materialised four representative completed `way` days:
  four baseline positive days, four materialised positive days, **zero** mismatches.
- The full bounded 14-day completed `way` window then measured 14 source days, 14 baseline
  positive days, 14 stored rollup days, and **zero** mismatches. The queue observation in
  that rolled-back check was transient; the final pre-release check found queue depth 0.

## Population and reader gate

- The paced initial run considered 126 source vehicle-days across active vehicles' current
  Analytics window. It used the one-key enqueue and one-item worker functions only; no
  range RPC or broad raw query was introduced.
- After activation, three pg_cron jobs were present: daily enqueue, five-minute single-item
  processing, and independent five-year purge. Queue depth was 0.
- Simulated authenticated owner read for `way`: 15 rows in **450.915 ms** with 7,440 shared
  buffer hits and temporary sort/work memory I/O. This is comfortably below the live
  eight-second statement timeout that previously cancelled the raw 14-day reader.
- A simulated different authenticated user received zero rows for the same owner/vehicle
  invocation. The public reader remains `SECURITY INVOKER`; the frozen raw baseline is still
  service-role-only.

## Outcome

The reader serves completed UTC dates from owner-scoped daily rollups. It performs the raw
calculation only for the timestamp boundary dates (and an unmaterialised-yesterday seam),
so a missing historical rollup cannot silently recreate a broad raw telemetry scan.
