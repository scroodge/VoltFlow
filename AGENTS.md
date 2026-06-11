<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Session startup memory

- At the start of a new session for this project, ask agentmemory for relevant project context before changing code or investigating behavior. Use concepts such as `voltflow-mate-charging-sessions`, `bydmate-telemetry-source-of-truth`, `charging-session-sync`, `mate-auto-start-stop`, and `charging-session-reconcile`.
- If agentmemory is unavailable, continue from this file and the repo docs, then save any durable decisions or progress back to agentmemory once it is available.

## VoltFlow Mate charging history

- Do not assume charging-history data is lost when a chart stops below the session target. First compare `charging_sessions.started_at/stopped_at/current_percent/target_percent` with `bydmate_telemetry_samples.device_time` and delayed samples around the stop time.
- Preserve delayed completion samples: VoltFlow Mate may report target SOC a few minutes after VoltFlow marks a session `completed`.
- When fresh VoltFlow Mate live SOC exists, never auto-complete a charging session from mathematical time-based estimates. Math can drive display fallback only; session completion must wait for fresh live SOC so the 100% cell-voltage tail is captured.

## Active charging session sync (`charging_sessions`)

- Mate ingest may **auto-start** a `charging_sessions` row via `isMateAutoSessionCharging` (only `charge_power_kw`, never traction `power_kw`; vehicle parked `speed_kmh ≤ 5`; not 100% balance tail) after **four** consecutive samples within the last **3 minutes** of the ingest batch. Start SOC and charger power come from telemetry; target defaults to 100%.
- Mate ingest may **auto-stop** an open session after two consecutive unplug samples, or immediately on drive-away (`speed_kmh > 5`, see `CHARGING_DRIVE_SPEED_KMH` in `charging-live.ts`).
- Server auto start/stop runs in `processBydmateAutoChargingSessions` on each successful ingest batch and needs **both** migration `20260602120000_bydmate_auto_charging_session_state.sql` and a **deployed** API build. If `bydmate_auto_charging_session_state` stays empty while charging, check production version and ingest JSON `auto_charging_sessions` (including `error`).
- Manual `stopChargingSession` uses `resolveStopProgressForSession` (`charging-session-finalize.ts`): fresh live SOC → latest in-session `bydmate_telemetry_samples` → wall-clock math only as fallback. Never persist math-only 100% when telemetry shows unplug or drive-away below target.
- `reconcileChargingSessionsForUser` (`charging-session-reconcile.ts`) runs after Mate ingest and when loading `/api/vehicle/sessions`: repairs recent rows with `stopped_at < started_at`, zero energy, or SOC below target when telemetry/live shows higher SOC (including 100% tail samples).
- Mate ingest auto start/stop uses `isMateAutoSessionCharging` (see [docs/CHARGING_SESSIONS.md](docs/CHARGING_SESSIONS.md)) and ignores samples with `device_time` before the active session `started_at`.
- Telemetry ingest writes `bydmate_telemetry_samples` and `bydmate_live_snapshots` only. It does **not** stream per-second `charging_sessions.current_percent` (auto hooks only create/stop rows and set stop-time fields).
- While `status = 'charging'`, the web app persists progress about once per second via `ChargingSessionBackgroundSync` in `MobileShell` (`useChargingSessionLiveSync`). This runs on dashboard, vehicle, charging, and other authenticated routes — not only on `/charging/[id]`.
- Shared logic lives in `src/lib/charging-session-sync.ts` (`deriveChargingSessionLiveBundle`): prefer fresh Mate charging/SOC snapshots (received within 90s), fall back to wall-clock math for **persist** when Mate is offline; filter live rows by `cars.vehicle_alias` when set.
- Auto-complete (PWA): `completionSource: live` when fresh Mate SOC reaches target (`shouldBlockAutoComplete` blocks drive-away / unplug). `completionSource: math` when Mate live is stale/absent (>90s) and wall-clock math reaches target — never while fresh live SOC is available. After close, `reconcileChargingSessionsForUser` corrects SOC/energy when the car wakes and telemetry disagrees.
- Drive-away guard: if fresh live telemetry shows movement during an open session, `useChargingSessionLiveSync` closes as `stopped` with live-derived SOC/energy/cost (`shouldAutoStopOnDriveAway`).
- Wake reconcile: when the car wakes and fresh SOC materially diverges from math/persisted progress, prefer live SOC for persisted `current_percent`.
- `ChargingSessionScreen` uses the same bundle for UI (`onDerived` → `useChargingUi`) with `skipPersist: true` so background sync is the single writer.
- If `current_percent` is stale in Postgres but telemetry is current, check whether the VoltFlow PWA/tab was open; history charts still use `bydmate_telemetry_samples`.
- Charging session charts (`/api/vehicle/charging-sessions/[sessionId]/samples`) resolve `vehicle_id` from `cars.vehicle_alias` → latest live snapshot → all user telemetry in the session window. Do **not** default to `DEV_WAY_VEHICLE_ID` (`"way"`) in production code.
