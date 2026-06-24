# Phase 0 — efficiency fixes (cut Vercel CPU + Supabase egress in place)

Goal: get back under the Vercel Fluid Active-CPU and Supabase **egress** caps
**without changing hosting**. Every item here reduces the ~1 Hz-per-vehicle load
that caused both limits. Re-measure after this phase before considering a migration
(see `docs/HOSTING_MIGRATION.md`).

Region `eu-west-1`, userbase dozens–hundreds.

## Scoreboard

| # | Item | Where | Impact | Status |
|---|------|-------|--------|--------|
| 1 | Session poll tiered: 60s / 5s / 1s by SOC | `charging-session-background-sync.tsx` | up to ~60× egress on worst offender | ✅ done |
| 2 | Gate reconcile to auto-session start/stop | `api/bydmate/telemetry/route.ts` | big CPU + egress | ✅ done |
| 3 | APK: charging-bulk flush interval | Android app (not this repo) | ~4× CPU on charging phase | ⬜ todo (smaller than first thought) |
| 4 | Trim `raw_payload` from verify re-read | `api/bydmate/telemetry/route.ts` | server↔DB egress | ✅ done |
| 5 | Retention prune cron for telemetry samples | new migration + cron | DB size + backup egress | ⬜ todo |

Status (2026-06-24): items 1, 2, 4 ✅ done; items 3 (APK) and 5 (prune cron) ⬜ open.
Test suite green (47/47, `npm run test`). Master plan: `docs/EGRESS_CPU_MASTER_PLAN.md`.

---

## ✅ 1 — Session poll tiered by SOC: 60 s / 5 s / 1 s (done)

Shared helper `chargingSessionsRefetchInterval` in `src/hooks/use-sessions-query.ts`,
used by **all three** observers of `queryKeys.sessions`:
`charging-session-background-sync.tsx`, `dashboard/dashboard-view.tsx`, and
`charging/charging-hub-view.tsx`.

> **Gotcha that made the first attempt ineffective:** TanStack Query refetches a
> shared query at the *shortest* refetchInterval among mounted observers. The
> dashboard (home screen) kept a flat 1 s poll, so it silently overrode the tiering
> whenever it was on screen. All observers now call the one helper so they can't
> diverge again. The hub was a flat 5 s with no visibility gate — also unified.

The poll fetched `charging_sessions` with `select("*") limit(100)` directly from
Supabase per charging user — the dominant egress source. Tiered on the max
`current_percent` of the charging sessions:

- **`< 95%` → 60 s** — long flat phase (hours); coarse refresh is fine.
- **`95–98%` → 5 s** — approaching the tail; ensures the 98% switch fires within ~5 s,
  since the threshold reads this same polled percent.
- **`≥ 98%` → 1 s** — balance tail: SOC barely moves, want fine resolution to catch
  the exact completion/stop.

Live SOC is unaffected; it rides the `bydmate-live` Realtime channel, not this poll.
The 95–98 % middle tier exists to avoid a blind spot: at 60 s, the entry into the
1 s tail could otherwise lag by up to a minute.

If egress is still high after item 3, consider a dedicated lightweight query for the
background sync (only the active charging row, only the columns the live-sync hooks
need) instead of reusing the full `queryKeys.sessions` list cache.

## ✅ 2 — Gate reconcile to auto-session start/stop (done)

`src/app/api/bydmate/telemetry/route.ts`. `reconcileChargingSessionsForUser` reads
sessions + samples back on each call; it was running on every ~1 Hz sample. Now it
runs only when `autoChargingSessions.started || .stopped`. The session-list load path
(`/api/vehicle/sessions`) still reconciles, so rows broken with no auto event are
repaired on next list load.

**Watch for:** an open session whose PWA closed won't get its `current_percent`
repaired until auto-stop fires or the list loads. Per `CLAUDE.md` that's acceptable
(auto-stop closes with live-derived SOC). If users report stale in-progress %,
revisit by reconciling also when an open `charging` session exists but throttled
(e.g. once per N seconds), not every sample.

---

## ⬜ 3 — APK: charging-bulk flush interval (smaller than first assumed)

**Correction after reading the APK (`BYDMate-own`):** the app is *already* batched and
cadence-adaptive — it does **not** POST one sample/sec. It samples charging at 10 s
(1 s only in the ≥98 % tail), driving at 1 s, parked at 30 s, and flushes batches
(`buildBatch` → `bydmate_ingest_telemetry_batch`) every 15 s active / 60 s parked. The
original "10–15×" win was based on a wrong assumption; that batching exists.

**Remaining lever:** during the long charging-bulk phase, samples queue every 10 s but
flush every 15 s → ~4 POSTs/min carrying 1–2 samples each, every one paying the full
server fixed cost (key lookup, previous-snapshot read, verify re-read, auto-session,
reconcile-if-changed).

**Change (in the APK):** give charging-bulk its own ~60 s flush interval (driving and
the ≥98 % tail stay at 15 s). Accumulates ~6 samples/POST → **~4× fewer charging-phase
backend invocations + verify reads.** Full plan, constants, safety notes, and tests:
`BYDMate-own/docs/CLOUD_SYNC_EGRESS_PLAN.md`. **No server change required.**

**Acceptance (server-observable):** charge still auto-starts within ~60–70 s of
plug-in, auto-stops cleanly, charts API still resolves samples, live status stays
≤90 s fresh.

---

## ✅ 4 — Trim `raw_payload` from the verify re-read (done)

**Done:** dropped `raw_payload` from the post-ingest verify `select` and removed the
`rawPayloadDiplus` helper + the "raw payload diplus missing" branch in
`persistenceError`. The `diplus` column check still proves persistence. Stops re-reading
the full echoed blob on every ingest request (the largest column in that read).
tsc + lint clean; auto-session (4/4) and sanitizer (6/6) tests pass.

Original notes:

`src/app/api/bydmate/telemetry/route.ts` (~line 256). After ingest, the route re-reads
the persisted row selecting:

```
vehicle_id, received_at, device_time, diplus, raw_payload,
diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v
```

`raw_payload` is the entire echoed telemetry blob, pulled back every request purely for
a sanity check (`persistenceError` → `rawPayloadDiplus`). At 1 Hz × hundreds of users
this roughly doubles ingest data volume as server↔DB egress.

**Options (pick one):**
- **a)** Drop `raw_payload` from the `select` and relax `persistenceError` to skip the
  "raw payload diplus missing" check (keep the `diplus` column check, which still
  proves persistence). Lowest egress.
- **b)** Skip the verify re-read entirely on **batch** ingest (item 3 makes single-sample
  ingest rare), keeping it only for the single-sample path.

**Acceptance:** ingest still returns `ok: true` on a normal charge; a deliberately
broken persist (e.g. simulate missing `diplus`) still reports an error.
`charging-auto-session.test.mjs` and the sanitizer tests still pass:

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test \
  src/lib/bydmate/charging-auto-session.test.mjs
npm run test
```

## ⬜ 5 — Retention prune cron for telemetry samples

`bydmate_telemetry_samples` grows ~1 row/sec/vehicle. A prune function already exists
(see `memory/telemetry-samples-size-reduction.md`, which dropped the DB 509→258 MB).
Running it on a schedule keeps DB size — and therefore backup/egress costs — bounded.

**Steps:**
1. Confirm the prune RPC/function name and retention window (check the migration that
   added it; do **not** edit applied migrations — add a new one if changing it).
2. Schedule it. Two options:
   - **pg_cron** in Postgres (preferred — stays inside the DB, no Vercel invocation,
     no egress). New migration: `cron.schedule('prune-telemetry', '0 3 * * *', $$ select prune_fn(); $$)`.
   - or a **Vercel Cron** hitting a small protected route, if pg_cron isn't enabled.
3. Apply one migration at a time: `npm run db:migrations:up` (status: `npm run db:migrations:status`).

**Acceptance:** prune runs on schedule; row count for samples older than the window
trends to ~0; charts and trips (which read recent samples) are unaffected.

---

## Re-measure (do this after item 3 lands)

1. Vercel → Observability → Functions: Active CPU for `/api/bydmate/telemetry` should
   drop sharply; confirm it's no longer the top consumer.
2. Supabase → Reports → Egress (or usage): bandwidth should fall with the slower poll +
   batching + trimmed verify read.
3. Turn on **Vercel Spend Management** + a **Supabase usage alert** so the next
   approach to a cap is a warning, not an outage.

If both metrics sit comfortably under quota → Phase 0 succeeded, no migration needed.
If not → proceed to `docs/HOSTING_MIGRATION.md` Phase 1/2.
