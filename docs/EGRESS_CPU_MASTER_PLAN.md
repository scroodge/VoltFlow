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
| C | VoltFlow | Trim `raw_payload` from verify re-read | **egress (biggest left)** | high | ⬜ |
| D | VoltFlow | Retention prune cron (pg_cron) | DB size + backup egress | med | ⬜ |
| E | APK | Charging-bulk flush interval (~60 s) | CPU (charging phase) | ~4× that phase | ⬜ |
| — | both | Re-measure + spend/usage alerts | — | gate | ⬜ |
| F | fallback | Self-host migration | both caps | escape hatch | deferred |

Rationale for order: C is the largest remaining egress lever and a small server edit;
D is cheap and bounds growth; E is the only remaining APK lever (smaller, needs a
Gradle build/test cycle); F only if A–E don't suffice.

---

## VoltFlow (server — `EvAcChargeTimer`)

### ✅ A — Tiered web session poll (done)
`src/components/charging/charging-session-background-sync.tsx`. `< 95%` → 60 s,
`95–98%` → 5 s, `≥ 98%` → 1 s; not charging → no poll. Removes the dominant egress
source (a `select("*") limit(100)` hit once/sec/charging user).

### ✅ B — Reconcile gated to auto-session start/stop (done)
`src/app/api/bydmate/telemetry/route.ts`. Reconcile (reads sessions + samples back)
now runs only when an auto session opened/closed; session-list load still reconciles.

### ⬜ C — Trim `raw_payload` from the verify re-read  ← do first
`src/app/api/bydmate/telemetry/route.ts` (~line 256). After ingest the route re-reads
the persisted row selecting `raw_payload` (the whole echoed blob) just for a sanity
check — at the per-request rate this is the **largest remaining Supabase egress**.
- Drop `raw_payload` from that `select`; relax `persistenceError` to skip the
  "raw payload diplus missing" branch (keep the `diplus` column check, which still
  proves persistence). Optionally skip the verify read entirely on batch ingest.
- **Acceptance:** normal charge returns `ok: true`; a simulated broken persist still
  errors. `npm run test` + `charging-auto-session.test.mjs` pass.

### ⬜ D — Retention prune cron
Schedule the existing telemetry-sample prune (see
`memory/telemetry-samples-size-reduction.md`) via **pg_cron** (stays in-DB, no egress)
in a *new* migration; apply with `npm run db:migrations:up`.
- **Acceptance:** old-sample count trends to ~0 on schedule; charts/trips unaffected.

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

## Sequencing notes

- C, D, E are independent — can land in parallel; no inter-repo ordering dependency.
- A + C alone should move egress the most; re-measure before committing to E or F.
- Each item is individually revertible; ship and measure rather than batching all five.
