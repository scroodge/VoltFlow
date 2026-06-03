# Charging sessions — architecture and 2026-06 fixes

Canonical reference for `charging_sessions` sync, Mate ingest auto start/stop, reconciliation, and operations.  
See also [AGENTS.md](../AGENTS.md), [SKILLS.md](../SKILLS.md) (Charging Skill), [supabase/TELEMETRY.md](../supabase/TELEMETRY.md).

## Who writes what

| Source | Writes to `charging_sessions` |
| --- | --- |
| User (PWA) | Start/stop actions; ~1 Hz progress while `status = charging` via `ChargingSessionBackgroundSync` |
| Mate ingest | Auto start/stop rows only (`processBydmateAutoChargingSessions`); not per-second SOC |
| Reconcile | Repairs broken/stale rows after ingest or when loading session list |

Telemetry history (`bydmate_telemetry_samples`) is always append-only from ingest. Charts and reconcile read from it.

## PWA live sync (`useChargingSessionLiveSync`)

- Bundle: `deriveChargingSessionLiveBundle` in `src/lib/charging-session-sync.ts`.
- **Display:** fresh charging snapshot → fresh SOC snapshot → wall-clock math.
- **Persist (~1 Hz):** same preference; `resolveStateToPersist` pulls live SOC when Mate wakes and drift &gt; 1%.
- **Complete session:**
  - `completionSource: live` — fresh Mate SOC (≤90s) at target, still charging, not driving (`shouldBlockAutoComplete`).
  - `completionSource: math` — Mate live stale/absent and wall-clock math at target (`shouldAllowMathAutoComplete`). Never math-complete while fresh live SOC is available.
- **Drive-away:** fresh movement → `stopped` with live SOC (`shouldAutoStopOnDriveAway`).
- **Manual stop:** `resolveStopProgressForSession` — live → in-session telemetry → math.

## Mate ingest auto start/stop

Implementation: `src/lib/bydmate/charging-auto-session.ts`, step logic in `charging-auto-session-step.ts`, detection in `isMateAutoSessionCharging` (`src/lib/bydmate/telemetry-charging.ts`).

### Auto-start (all required)

| Rule | Value |
| --- | --- |
| Charging signal | `charge_power_kw > 0.1` **or** `is_charging` while parked and SOC &lt; 100% |
| Never use | traction `power_kw` (was the cause of phantom sessions on 2026-06-03) |
| Parked | `speed_kmh ≤ 5` (or unknown) |
| Consecutive samples | **4** at ~1 Hz |
| Sample age | start only if `device_time` within **3 minutes** of newest sample in batch |
| Car match | `cars.vehicle_alias` = Mate `vehicle_id` |
| DB state | `bydmate_auto_charging_session_state` (migration `20260602120000`) |

### Auto-stop

| Rule | Value |
| --- | --- |
| Unplug | **2** consecutive non-charging samples while session open |
| Drive-away | immediate when `speed_kmh > 5` |
| Stale sample guard | ignore ingest samples with `device_time` **before** session `started_at` |
| `stopped_at` | never earlier than `started_at` |

Ingest response (debug): `auto_charging_sessions`, `charging_session_reconcile`.

## Reconciliation (`reconcileChargingSessionsForUser`)

Runs after each Mate ingest (per vehicle) and on `GET /api/vehicle/sessions`.

Repairs last **14 days**, non-`charging` rows when:

- `stopped_at` &lt; `started_at`
- `charged_energy_kwh = 0` or SOC below target while telemetry/live shows higher SOC
- `completed` with 0 kWh at target (verify against telemetry)

Logic: `src/lib/charging-session-reconcile-logic.ts` (pure), `src/lib/charging-session-reconcile.ts` (Supabase).

## History UI

Session card **«Старт → Итог»** shows `start_percent → current_percent`, not target. Target 100% is a separate row only when `current_percent` is still below target.

## Migrations (applied 2026-06-02)

| File | Purpose |
| --- | --- |
| `20260602103500_fix_false_completed_charging_sessions.sql` | Backfill false `completed` (max SOC &lt; target + movement) → `stopped` |
| `20260602120000_bydmate_auto_charging_session_state.sql` | Counters for ingest auto start/stop |

Requires **deployed** API code; migrations alone are not enough.

## Incident 2026-06-03 (vehicle `way`)

**Symptoms:** ~170 phantom sessions; stopping the car started a “charging cycle”; real AC charge only ~2 minutes at 84%.

**Root cause:** `isAcWallboxCharging` treated traction `power_kw` as charging power. Ingest batches replayed driving samples → auto-start.

**Fix:** `isMateAutoSessionCharging` (no `power_kw`), parked check, 4 samples, 3-minute start window.

**Data cleanup (run after deploy with fixed API):**

```bash
node --env-file=.env.local scripts/cleanup-way-phantom-sessions-2026-06-03.mjs --dry-run
node --env-file=.env.local scripts/cleanup-way-phantom-sessions-2026-06-03.mjs --yes
```

Edit `KEEP_SESSION_IDS` in the script if the active real session id changed. Script keeps the morning completed session and one real afternoon session.

## Tests

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test \
  src/lib/bydmate/telemetry-charging.test.mjs \
  src/lib/bydmate/charging-auto-session.test.mjs \
  src/lib/charging-session-reconcile.test.mjs
```

## Git workflow (from 2026-06)

Charging-session work is merged on `main` (or your default branch). **New product features use new branches:**

```bash
git checkout main && git pull
git checkout -b feature/short-description
# … work, test, docs …
git push -u origin feature/short-description
# open PR → review → merge
```

Do not stack unrelated features on the same branch as large charging/ingest changes. Update this doc or `AGENTS.md` when charging rules change again.
