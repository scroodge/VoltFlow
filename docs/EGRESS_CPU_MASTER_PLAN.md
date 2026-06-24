# Master plan — clear the Vercel Fluid CPU + Supabase egress caps

Single coordinated plan across both repos. Detail docs:
- VoltFlow server: `EvAcChargeTimer/docs/PHASE_0_EFFICIENCY.md`
- APK: `BYDMate-own/docs/CLOUD_SYNC_EGRESS_PLAN.md`
- Migration fallback: `EvAcChargeTimer/docs/HOSTING_MIGRATION.md`

Context: `dozens–hundreds` users, region `eu-west-1`. Hit **both** caps. Root cause is
~1 Hz-per-vehicle work, but the two caps have **different** dominant sources:

- **Supabase egress** = data *leaving* Supabase = the **read** path (web client polling
  + the server's verify re-read). APK uploads are *ingress* (don't count).
- **Vercel Active CPU** = compute per function invocation × invocation count = the
  **telemetry ingest** hot path (and its per-request fixed work).

Fix the read path for egress; fix invocation count + per-request work for CPU.

## Roadmap (do in this order)

| # | Repo | Task | Targets | Impact | Status |
|---|------|------|---------|--------|--------|
| A | VoltFlow | Tiered web session poll (60/5/1 s by SOC) | egress | ~high | ✅ done |
| B | VoltFlow | Gate reconcile to auto-session start/stop | CPU + egress | high | ✅ done |
| C | VoltFlow | Trim `raw_payload` from verify re-read | **egress (biggest left)** | high | ✅ done |
| D | VoltFlow | Enable pg_cron + register tiered purge | DB size + backup egress | med | ✅ done (cron live; was never registered before) |
| E | APK | Charging-bulk flush interval (~60 s) | CPU (charging phase) | ~4× that phase | ✅ done |
| — | both | Re-measure + spend/usage alerts | — | gate | ⬜ |
| F | fallback | Self-host migration | both caps | escape hatch | deferred |

Rationale for order: C is the largest remaining egress lever and a small server edit;
D is cheap and bounds growth; E is the only remaining APK lever (smaller, needs a
Gradle build/test cycle); F only if A–E don't suffice.

### Current status (2026-06-24)

- **A, B, C done.** A (+ the `useBydmateTelemetryPointsQuery` dead-code removal) was
  committed by the user as `af51ae9` "unify session polling logic and remove dead code".
- **Test suite green: 47/47** (`npm run test`). Along the way, fixed a pre-existing
  break: `charging-session-sync.ts` / `charging-live.ts` used `@/` path aliases that the
  Node test runner can't resolve — converted to relative `.ts` imports.
- **Uncommitted working-tree changes:** `src/app/api/bydmate/telemetry/route.ts` (C),
  `src/lib/charging-session-sync.ts`, `src/lib/charging-live.ts` (test fix).
- **E done & released:** APK charging-bulk 60 s flush (driving + ≥98% tail stay 15 s),
  debug suite 417/417. Shipped as **v0.4.3 (328)** — committed + tagged `v0.4.3` +
  GitHub release with `VoltFlow-Mate-v0.4.3.apk` (debug). Supabase `mate_app_releases`
  publish (in-app update banner) NOT done — needs `tools/publish-mate-release.sh` with
  service-role creds.
- **D done:** prod check revealed **no retention cron was ever live** (pg_cron disabled).
  User enabled pg_cron; migration `20260624130000` applied; `purge-bydmate-telemetry`
  cron now registered (`0 3 * * *`). Currently 0 rows eligible (all >30 d data is
  premium-owned, kept 365 d) — verified correct.
- **All code/infra items A–E + D done.** Migration `20260624130000` is uncommitted in
  the EvAcChargeTimer working tree (with C + the test fix).
- **Remaining (user-side):** re-measure Vercel CPU + Supabase egress over a few days,
  and turn on Vercel Spend Management + a Supabase usage alert.

---

## VoltFlow (server — `EvAcChargeTimer`)

### ✅ A — Tiered web session poll (done)
Shared helper `chargingSessionsRefetchInterval` (`src/hooks/use-sessions-query.ts`)
used by all three `queryKeys.sessions` observers: background-sync, dashboard-view,
charging-hub-view. `< 95%` → 60 s, `95–98%` → 5 s, `≥ 98%` → 1 s; not charging/visible
→ no poll. Removes the dominant egress source (`select("*") limit(100)` per charging
user).
**Verification caught a defect:** the dashboard kept a separate flat 1 s poll on the
same shared query; since TanStack refetches at the *shortest* observer interval, it
overrode the tiering whenever the home screen was open. Fixed by routing all three
through the one helper.

### ✅ B — Reconcile gated to auto-session start/stop (done)
`src/app/api/bydmate/telemetry/route.ts`. Reconcile (reads sessions + samples back)
now runs only when an auto session opened/closed; session-list load still reconciles.

### ✅ C — Trim `raw_payload` from the verify re-read (done)
`src/app/api/bydmate/telemetry/route.ts` (~line 256). After ingest the route re-reads
the persisted row selecting `raw_payload` (the whole echoed blob) just for a sanity
check — at the per-request rate this is the **largest remaining Supabase egress**.
- Drop `raw_payload` from that `select`; relax `persistenceError` to skip the
  "raw payload diplus missing" branch (keep the `diplus` column check, which still
  proves persistence). Optionally skip the verify read entirely on batch ingest.
- **Acceptance:** normal charge returns `ok: true`; a simulated broken persist still
  errors. `npm run test` + `charging-auto-session.test.mjs` pass.

### ✅ D — Retention purge cron (done 2026-06-24)

**Resolved:** user enabled pg_cron (1.6.4) via Dashboard; migration `20260624130000`
applied. `cron.job` now has `purge-bydmate-telemetry` — `0 3 * * *`, active, running
`select public.purge_old_bydmate_telemetry_by_tier()`. Verified the tiered logic against
prod: of 373,380 samples (338 MB, 7 users, 3 premium), 10,099 are >30 d old and **all
belong to premium users** (kept 365 d), so `samples_to_purge = 0` right now — correct.
The job will purge non-premium data past 30 d and premium past 365 d as it ages. No
manual delete run (let the 03:00 UTC job handle any future backlog at low traffic).

Original analysis below.


**Verification finding (important):** a tiered retention purge *function* already
exists — `purge_old_bydmate_telemetry_by_tier()` (migrations 20260617133000 /
20260617135500): deletes `bydmate_telemetry_samples` + `bydmate_trip_track_points`
older than **365 d (premium) / 30 d (non-premium)**, hourly rollup > 3 y. Migrations
20260530120000 / 20260617133000 also contain the `cron.schedule(...)` call — **but
guarded by `if pg_cron exists` with errors swallowed.** Prod check
(`select … pg_extension where extname='pg_cron'` → empty; `cron.job` missing) confirms
**pg_cron was never enabled, so the `purge-bydmate-telemetry` job was never registered —
there is currently NO automated retention.** The 509→258 MB drop was a one-time manual
prune. (My original plan pointed at the wrong helper, `bydmate_prune_telemetry_samples`,
which is unscheduled and superseded by the tiered purge — do not schedule that.)

**Fix:** migration `20260624130000_enable_pg_cron_schedule_telemetry_purge.sql` enables
pg_cron and (idempotently) registers the daily 03:00 UTC tiered purge. It is the only
pending migration.

**Plan:** user enables pg_cron in Supabase Dashboard (Database → Extensions) first
(create-extension via pooler may lack permission), then apply with
`npm run db:migrations:up -- --db-url-from-pooler --password-env=SUPABASE_POSTGRESS_PASSWORD`.
- **Acceptance:** `select jobname, schedule from cron.job` shows `purge-bydmate-telemetry`
  at `0 3 * * *`; a manual `select public.purge_old_bydmate_telemetry_by_tier();` returns
  deletion counts; charts/trips unaffected (purge respects 30/365 d windows + rollup).

---

## APK (`BYDMate-own`)

> Already batched + cadence-adaptive (sampling: driving 1 s, charging-bulk 10 s,
> tail ≥98% 1 s, parked 30 s; flush 15 s active / 60 s parked, batched). The earlier
> "batch the APK 10–15×" item was a wrong assumption and is effectively done.

### ⬜ E — Charging-bulk flush interval
`CloudTelemetrySender.kt`. Give charging-bulk its own ~60 s flush (driving + ≥98% tail
stay 15 s) so the long charge sends ~6-sample batches instead of ~4 tiny POSTs/min.
~4× fewer charging-phase backend invocations + verify reads.
- Add `CHARGING_BULK_FLUSH_INTERVAL_MS = 60_000L`; choose flush interval by state in
  `flushPending`; **keep a prompt flush on the charging-start transition** so server
  auto-start (4 consecutive `charge_power_kw` samples) isn't delayed.
- Tests in `CloudTelemetrySenderTest` / `CloudTelemetryCadenceTest`; build debug only:
  `./gradlew testDebugUnitTest assembleDebug`.
- **Acceptance (server-observable):** charge auto-starts within ~60–70 s of plug-in,
  auto-stops cleanly, charts resolve samples, live status ≤90 s fresh.
- **Guard:** do not reintroduce the `cloud_sync_vehicle_id` header/body mismatch hazard.

Full detail: `BYDMate-own/docs/CLOUD_SYNC_EGRESS_PLAN.md`.

---

## Measure + guardrails (the go/no-go gate)

After C–E land:
1. Vercel → Observability → Functions: `/api/bydmate/telemetry` Active CPU should drop
   and no longer top the list.
2. Supabase → Reports → Egress: bandwidth should fall (poll + verify-read trim).
3. Turn on **Vercel Spend Management** + a **Supabase usage alert** so the next
   approach to a cap is a warning, not an outage.

**Decision:** both metrics comfortably under quota → done, no migration. Still over →
proceed to `HOSTING_MIGRATION.md` (Phase 1 self-host full Supabase on Hetzner, or
Phase 2 managed-Postgres split).

## Verification findings (architecture audit)

- **APK posts to the Vercel route**, not the Supabase edge fn
  (`DEFAULT_CLOUD_SYNC_URL = https://volt-flow-beige.vercel.app/api/bydmate/telemetry`)
  — so APK ingest does drive Vercel CPU. Edge fn (`supabase/functions/bydmate-telemetry`)
  is unused by the live APK.
- **Item C confirmed safe:** route `raw_payload` is used only by the verify check
  (`rawPayloadDiplus`→`persistenceError`) + the write at the ingest RPC; nothing else.
- **Item D confirmed:** `public.bydmate_prune_telemetry_samples(p_keep_days default 30)`
  exists (migration `20260617120000`) — only needs scheduling.
- **Auto-start rule confirmed:** server tracks `consecutive_charging_samples` from
  `charge_power_kw` (`src/lib/bydmate/charging-auto-session.ts`).
- **Dead code:** `useBydmateTelemetryPointsQuery` (`select("*") limit(2000)` from
  `bydmate_telemetry_points`, ungated 15 s poll) has **no callers** — not a live egress
  source, but delete it so it can't be wired up later by accident.
- Other live pollers are reasonable: charging-session samples via
  `/api/vehicle/charging-sessions/[id]/samples` (15 s, only while session screen open),
  trips (15 s, page-visible-gated), live snapshot (60 s + Realtime). Leave as-is.

## Sequencing notes

- C, D, E are independent — can land in parallel; no inter-repo ordering dependency.
- A + C alone should move egress the most; re-measure before committing to E or F.
- Each item is individually revertible; ship and measure rather than batching all five.
