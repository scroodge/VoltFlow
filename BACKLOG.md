# Backlog — proposed plans awaiting go-ahead

Per the agent workflow in [AGENTS.md](AGENTS.md): **plan first, build only on explicit
go-ahead.** These are researched but **not built**. Shipped work lives in
[CHANGELOG.md](CHANGELOG.md).

## 🔵 Consumption formula map — reference for the parts left as separate tools

The "average consumption" discrepancy investigation (shipped 2026-08-04, see
CHANGELOG.md) found 8 distinct kWh/100km formulas across the app. Two were genuine
duplicate re-derivations of the same math and have been consolidated (see CHANGELOG).
The rest are **intentionally different tools**, kept here as a map so a future "why does
X disagree with Y" doesn't have to be re-researched from scratch.

### Research — every distinct formula found (8, feeding 15+ display sites)

**A. Per-trip, net of regen** — `(traction_kwh − regen_kwh) / distance_km × 100`.
Canonical home: `src/lib/bydmate/trip-metrics.ts` (`tripTractionEnergyKwh()`,
`tripNetConsumptionKwh100()`, `tripEnergyPerKm()`).
- `tripNetConsumptionKwh100()` → History → Trips tab (`history-view.tsx:147-149,799`,
  label `vehicle.trips.netConsumption`) and Vehicle Live trip list
  (`vehicle-live-view.tsx:1306-1308,1316`, same label).
- `tripEnergyPerKm()` — gross kWh/**km** (not /100), same two files, label
  `vehicle.trips.energyPerKm`.
- ~~`range-estimate.ts` `averageEnergyConsumption()` re-derived the same net formula
  inline~~ — **consolidated 2026-08-04**, now calls `tripNetConsumptionKwh100()`.
- ~~`history-day-summary.ts` `tripDriveKwh()` re-derived the same gross-traction
  fallback~~ — **consolidated 2026-08-04**, now calls `tripTractionEnergyKwh()`.

**B. Device-reported `avg_consumption_kwh_100km` field, distance-weighted average** —
was 5 independent implementations with 3 different filters; **consolidated 2026-08-07**
into `trip-metrics.ts` `weightedAvgConsumptionKwh100()` (see CHANGELOG). Display sites,
all now on the one helper:
- Analytics day view "Day average" + baseline/regen-compare cards (`day-insights.ts`
  re-exports the helper; `analytics-day-view.tsx`).
- Analytics summary stat tile (`vehicle-analytics.ts` `fetchMonthlyStats()` →
  `telemetry-analytics-charts.tsx`).
- Vehicle Analytics summary panels (`telemetry-buckets.ts` `buildAnalyticsSummary()` →
  `vehicle-analytics-panels.tsx`).
- Efficiency bar chart + period-average dashed line (`telemetry-analytics-charts.tsx`
  `buildBarCharts()`, grouped per bucket).
- Vehicle Live SummaryPill (label `vehicle.trips.consumption`) and the range/ETA blend —
  `range-estimate.ts` `averageTripConsumption()` deleted, including its unweighted-mean
  fallback.

**C. Device-reported field, median** (baseline/fallback pools)
- `src/lib/vehicle-analytics.ts:469-513` `fetchConsumptionBaseline()` (30-day rolling) →
  "X% better/worse than your 30-day median" (`analytics-day-view.tsx:126-130,286`).
- `range-estimate.ts:40` `userMedianConsumption()` → range-estimate fallback pool.

**D. Device-reported field, unweighted average per bucket**
- `telemetry-buckets.ts:266-291` `consumptionByOutsideTemp()` → temp-vs-consumption chart
  (`vehicle-analytics-panels.tsx:477`).
- `src/lib/bydmate/route-insights.ts:526-572` per-route median/min/max → route prediction
  card (`route-insights-section.tsx:244,254-262`).

**E. Net-of-regen total-over-total (day/period)**:
- `src/lib/history-day-summary.ts` `avgConsumptionKwh100 = (driveKwh − regenKwh) /
  distanceKm × 100`, where `driveKwh` sums `tripTractionEnergyKwh()` per trip (group A's
  canonical helper) → `HistoryDaySummaryCard`, all scopes (day/week/month/quarter/year).
  Matches group A's net-of-regen semantic by decision (2026-08-04); the card's "On trips"
  cell intentionally stays gross traction (it feeds the charge/drive balance math), so
  avg-consumption × distance will not exactly equal "On trips" kWh — accepted trade-off.

**F. Raw device/live field, no averaging** — displayed as-is:
- `dashboard-view.tsx:217-220` `drivingStatsFromLive()`, `dashboard-deferred-summaries.tsx:108`,
  `vehicle-live-view.tsx:949` — each reads `current_trip_consumption_kwh_100km` or
  `trip.avg_consumption_kwh_100km` directly.

**G. Blended forecast** (range/ETA — legitimately its own thing, not "a consumption
display"): `range-estimate.ts:67-225` `estimateVehicleRangeKm()` weights B, F, and an
A-variant together, clamped 8–42 kWh/100km, to project range. Out of scope for
consolidation — it's a forecast, not a reported stat.

### Why B/C/D/F/G stay separate (deliberate, not drift)

Aggregation strategy varies **on purpose**: weighted-by-distance average of device values
(B) vs. median (C, deliberately outlier-resistant for baselines) vs. net total-over-total
(E, deliberately exact for a day/period) vs. raw instantaneous (F, deliberately "right
now") vs. a multi-signal blend (G, a forecast, not a reported stat). Collapsing these into
one aggregation would likely make at least one of {30-day baseline, live tile, day
summary, range forecast} worse at its actual job — so only the genuine duplicates (group
A's re-derivations) were consolidated; see CHANGELOG.md 2026-08-04.

**Amended 2026-08-07:** that reasoning is sound *between* groups but was wrongly applied
*within* group B, which was five copies of a single formula disagreeing on filters, not
five different tools — consolidated, see CHANGELOG.md 2026-08-07. The one consumption
question still open is deliberate and unbuilt: **which basis is "the" user-facing average**
— net-of-regen measured energy (A) or the device's own field (B). They differ for the same
trip, so History → Trips and the Vehicle Live pill still disagree by design. Switching
would move the headline number on four pages and invalidate the stored 30-day baseline's
comparability, so it needs an explicit decision rather than a refactor.

---

## 🔵 Suspended head unit: "app is offline" while Di+ keeps recording

### Goal

A parked or locked car must keep reporting often enough that the PWA can tell **"car
asleep"** from **"no contact"**. Today the reporting cadence on a suspended head unit
collapses to **one sample per ~15 minutes**, which the PWA's 90 s freshness threshold
reads as stale ~94% of the time.

Reported by user `kevlar_5@meta.ua` (2026-08-03), who correctly noted that **Di+ keeps
writing video** through the whole outage — Di+ is BYD's own privileged app and is exempt
from the head unit's power management; VoltFlow Mate is not.

### Research findings — prod DB, read-only (2026-08-03)

All times Europe/Minsk (the reporter's profile TZ). Evidence from
`bydmate_telemetry_samples` on self-hosted prod.

**3 August — matches the report exactly**

| Time | Observed |
| --- | --- |
| …–16:20:14 | Healthy: 1 Hz sampling, batches of ~14 delivered every ~17 s |
| 16:22:44 | +150 s |
| 16:30:44 | +480 s |
| 16:45:44 / 17:00:44 / 17:16:48 / 17:31:48 | **+900 s each** — one single sample per 15 min |
| 17:38 (his check) | Newest data 17:31:48 = **6+ min old** → past 90 s → shown stale |
| 17:55:28 | App wakes, dumps backlog whose oldest sample is 16:20:14 — **5714 s (95 min)** delivery lag |

**1 August — also matches, to the minute.** Last dense sample 13:03:29, then singles at
13:13:02 → 13:28:02 → 13:43:05 → 13:58:09 → 14:13:09 → **14:28:12**, then nothing until
15:00:57. His *"прога связывалась с авто до 14.30"* is literally the daemon's last 15-min
wake-up at 14:28:12.

**The 900 s interval matches no constant in the code.** `MAX_BACKOFF_MS` 30 s,
`PARKED_CLOUD_HEARTBEAT_MS` 30 s, `TELEMETRY_PUSH_MS` 60 s, daemon loop 6 s. It is imposed
from outside the app by platform suspend.

**Two distinct device-side defects, one per sender** (the "two senders" rule in
[AGENTS.md](AGENTS.md) applies — a fix in one is not a fix):

1. **`CommandDaemon` (car off) holds no wakelock at all.** A plain `Thread.sleep` loop in a
   shell-uid process; when the head unit suspends it only advances during the platform's own
   wake windows. `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is declared in the manifest but
   covers only the app process, not the shell daemon.
2. **`TrackingService` (app path) has a self-deadlocking wakelock.**
   `WAKE_LOCK_DURATION_MS` is 30 min but `renewWakeLockIfNeeded()` is called *only from
   inside the polling loop* (`TrackingService.kt:908,969`). Once the loop is starved past
   30 min the lock expires and can never renew itself — which is why the 3 Aug stall ran
   95 min.

This extends the existing rule in AGENTS.md ("the daemon's loop period — not its push
interval — is the floor on its latency"): **on a suspended head unit the platform's wake
period is the floor, and the loop period is irrelevant.**

**Fleet-wide, not user-specific.** Share of long gaps landing at exactly 14–16 min over
7 days: barbaly3615 **80.4%**, philon96 **83.4%**, alexavr69 **85.9%**, scroodgemac 29.4%,
kevlar_5 **39.5%**. Worst per-user delivery lag runs 8 h to **42 h**. The 15-min phase is
spread across `minute % 15` fleet-wide — each device runs its own idle timer, so this is
per-device suspend, not coalesced alarms or anything server-side.

**Confirmed working, do not touch:** `bydmate_prevent_stale_live_snapshot_update`
correctly rejected the 95-min-old backlog (`if new.device_time < old.device_time then
return old`), so the live snapshot was never rewritten backwards. `isFreshLiveSnapshot`
keys off `received_at` and was accurate — the data really was stale.

### Repo boundary

Items 1–2 land in **`BYDMate-own`** (Android/Kotlin). Item 3 lands in **this repo**. They
ship independently; item 3 is worth doing regardless, because no cadence fix makes a
sleeping car report continuously.

### Options and trade-offs

**A — Device settings only (no code).** Have users exempt Mate from battery optimization /
enable autostart on the head unit.
*Pro:* zero code, testable today, likely fixes the app path immediately.
*Con:* per-user manual step, silently regresses on reinstall or OS update, does nothing for
the shell-uid daemon, and cannot be verified remotely. Not a fix — a workaround.

**B — Fix both senders' wake handling (recommended).**
Give `CommandDaemon` a wakelock (or drive it from `setExactAndAllowWhileIdle` rather than
`Thread.sleep`), and renew the `TrackingService` wakelock from an independent timer that
cannot be starved by the loop it is protecting.
*Pro:* addresses both root causes; restores the *intended* 30–60 s parked cadence.
*Con:* touches the hardest-to-test code in the project; exact-alarm rate limits mean the
daemon may still not reach 60 s on every OEM. Battery cost on a car-off head unit needs
measuring, not assuming.

**C — UI honesty only.** Leave cadence alone; replace the binary stale badge with a
"last contact HH:MM" and an explicit asleep state.
*Pro:* small, entirely in this repo, removes the false "broken" impression.
*Con:* the car still is not reporting — comfort controls and auto-stop stay degraded.

### Recommendation

**B + C together, in that priority order.** B removes the cause; C makes the remaining,
legitimate sleep windows legible instead of alarming. A is worth telling the reporter
*today* as an interim step while B is built, but must not be recorded as the resolution.

Do not raise `LIVE_SNAPSHOT_STALE_MS` to paper over this — it would mask a real 15-min
outage and weaken every freshness guarantee that depends on it (charging priority rules
in `docs/CHARGING_SESSIONS.md` use the same 90 s notion of fresh).

### Data ownership and location

No new user-facing data model, no new preference, no schema change. Item 3 is a pure
presentation change over the existing `bydmate_live_snapshots.received_at`. Items 1–2 are
device-side runtime behavior only. **Nothing to confirm on ownership/location.**

### Implementation phases after approval

1. **Instrument first.** Per the AGENTS.md rule about fire-and-forget paths, log daemon
   wake-ups and wakelock acquire/renew/expire before changing behavior — otherwise "it
   still stalls" is unattributable.
2. `CommandDaemon` wakelock / alarm-driven wake. Keep the decision logic in the pure
   `internal` functions (`planPush`, `loopSleepMs`) covered by `CommandDaemonTest`.
3. `TrackingService` independent wakelock renewal.
4. PWA: asleep-vs-offline state + "last contact HH:MM".

### Acceptance criteria

- On a locked car, ≥95% of consecutive `device_time` gaps are ≤90 s over a 2 h parked
  window (currently ~900 s).
- No sample delivered with `received_at - device_time > 5 min` in normal operation.
- Fleet 14–16 min gap share drops below 5% for users on the fixed build.
- PWA never labels a car "offline" when a sample arrived within the last 15 min.

### Side finding — separate issue, needs its own check

The sparse daemon samples carry `is_charging: true` with `charge_power_kw: null` and
`diplus_charge_gun_state = 1`. Per AGENTS.md, gun state `1` is **unplugged** and the
`is_charging` fallback is invalid there. Reduced DiPars payloads on the daemon path may be
feeding a false charging state into `processBydmateAutoChargingSessions`. Not part of this
plan — flagged so it is not lost.

---

## Advanced admin workspace: activation, retention, and audit history

### Goal

Extend the shipped KPI and needs-attention workspace with evidence of whether signup becomes
lasting Mate usage and accountability for privileged admin changes.

### Phases

1. **Activation and retention.** Show `registered → car linked → first telemetry → active
   after 7 days`, weekly/monthly active telemetry users, and signup-cohort retention.
   Use app-owned Postgres aggregates for efficient historical reads.
2. **Admin audit log.** Record premium/admin-role changes, acting admin, affected account,
   timestamp, prior/new values, and an optional reason.

### Data ownership and location — confirmation required before implementation

The audit log is **app-owned operational data in Postgres**, not user preference
data and not `localStorage`. It retains administrative history, so its retention policy,
visible fields, and access scope must be confirmed before building. Activation/retention derives
their results from existing user, car, snapshot, telemetry, release, and entitlement facts.

### Recommendation

Build activation/retention only if the funnel will drive concrete product decisions. Plan
the audit log separately with explicit retention and visibility decisions. Keep host and
Supabase infrastructure health in Grafana rather than duplicating it in the application.

---

## 🔵 Telemetry efficiency and reliable trip-finalization roadmap

### Goal

Make the car-to-cloud path cheaper without weakening the Telegram widget, PWA live view,
trip history, charging correctness, or the car-off case. The key change is a versioned
event contract: the Mate prepares compact physical segments and durable end events; the
cloud validates them and remains the canonical owner of user-visible history.

### Status refresh (2026-07-21) — code-verified

Owner restated the two objectives: (1) car status reaches **every** surface — PWA, web,
Telegram Mini App, Telegram widget — almost immediately; (2) a fast, reliable tiered
transfer schema where urgent/live data goes immediately and the rest is delayed.

**Objective 1 is shipped except for one surface.** Viewer-gated fast mode is live and
measured (see [CHANGELOG.md](CHANGELOG.md) → "Viewer-gated fast live status"):

| Surface | Fast mode? | Latency today |
| --- | --- | --- |
| PWA / web | yes — `MobileShell.tsx:37-48` heartbeat | live snapshot 5-9 s (app path) |
| Telegram Mini App | yes — renders the same `MobileShell` | same as PWA |
| Car-off daemon path | yes | ~3 s push cadence |
| **Telegram widget (bot message)** | **no** | **30-90 s** |
| Web-push live status | no gate | ingest-cadence bound |

The widget is the gap: `THROTTLE_MS = 30_000` (`src/lib/telegram/live-widget.ts:10`) is a
hard floor, and nothing grants fast mode when the app is closed, so the batch cadence
(15-60 s) stacks on top of it.

**Objective 2 is half-built.** The tiering is real on the wire (1 Hz driving / 10 s
charging / 30 s parked, flushed 15-60 s) and real in Postgres — migration
`20260716100000` gives `live_only: true` a snapshot-only fast path with no history,
hourly, or trip writes. **But `/api/bydmate/telemetry` does not honour the class.** No
`live_only` guard exists in any of the four fan-out handlers, so a 3 s status ping pays
the same ~12-15 round trips as a full batch:

1. profile auth read · 2. previous-snapshot select · 3. ingest RPC ·
4. **`profiles.last_active_at` UPDATE, unconditional** (`route.ts:274-280`) ·
5. persisted-snapshot verify select · 6. charge-notification reads ·
7. live-status-notifications (profiles + state select) · 8. Telegram widget
(cars + profiles + widget row) · 9. auto-session (3 selects,
`charging-auto-session.ts:270`)

Two specific wastes worth naming:

- `last_active_at` is consumed only by an inactivity cron at **30/60-day** granularity
  (`src/app/api/cron/inactivity-check/route.ts`). The client-side `touchUserActivity`
  already self-throttles to 1/hour via `localStorage`; the ingest path does not. It writes
  the same `profiles` row the ~6 s command poll reads, every 3 s, during fast mode.
- `updateTelegramLiveWidgets` performs `loadCars`, a `profiles` select, `loadWidgetRow`
  and full HTML construction **before** the 30 s throttle check at
  `live-widget.ts:352-359`. The throttle saves a Telegram API call but no database work.

This is P1 below, now with measured justification rather than an estimate.

### Near-term goals derived from the refresh

#### G1 — Telegram widget reaches parity

**Constraint discovered while planning:** Telegram provides **no viewer signal** for a bot
message. The widget's only button is `web_app` (`live-widget.ts:258`) and the webhook
handles no `callback_query`, so the PWA's "someone is watching" heartbeat has no direct
analogue. Options:

- **A — Lower the throttle only (~7-10 s).** The widget then tracks whatever delivery
  cadence exists, so it inherits fast mode for free whenever the app or Mini App is open.
  Telegram's general per-chat limit is about one message per second, so 30 s is far more
  conservative than the API requires. *Pro:* smallest change, no new signal, no added
  invocations. *Con:* standalone widget (app closed) still sits at 15-60 s.
- **B — Add an explicit refresh button that grants a fast window.** Give the widget a
  second inline button with `callback_data`; handle `callback_query` in the webhook, map
  `telegram_id` → profile, and stamp the existing `live_fast_until` / `live_fast_vehicle_id`
  columns. *Pro:* a genuine standalone viewer signal reusing the shipped mechanism; cost is
  bounded by taps. *Con:* pull rather than continuous — one tap buys one window; needs
  webhook callback handling that does not exist yet.
- **C — State-gated always-on fast cadence.** Push fast whenever the car is charging or
  driving, regardless of viewers. *Pro:* widget is always current. *Con:* this is the
  rejected always-on option scoped to active states; it spends invocations continuously and
  erodes offload phases 0-3. **Reject.**

**Decision 2026-07-29: stage both A and B.** G2 will keep the 30-second edit throttle and
make its eligibility check cheap first. Reconsider a faster widget cadence only after
G2 has production evidence; B remains a separate follow-up. G1 depends on G2 — see below.

#### G2 — Server-side persistence classes — SHIPPED 2026-07-29

Implemented in production as commit `15c370b`; see
[CHANGELOG.md](CHANGELOG.md#snapshot-only-live_only-ingest-g2). G1 remains staged until
G2 has production cost evidence. The former G3 reliability premise was superseded by the
current Mate contract: client-owned trips have a Room-first final block, immediate flush on
confirmed `P → power off`, and a 20-minute next-boot finalizer. The cloud already accepts
that final block through `bydmate_apply_client_trip`.

#### G3 — Client-trip finalization observability — SHIPPED 2026-07-29

Implemented in production; see
[CHANGELOG.md](CHANGELOG.md#client-trip-finalization-observability-g3). Modern `client_trip`
final blocks are now measured atomically when the cloud accepts them. G1 remains staged until
G2 has production cost evidence.

### Data ownership and location for G1-G3

**No new user preference.** The fast-mode window remains
ephemeral app-owned state in the two existing nullable `profiles` columns
(`live_fast_until`, `live_fast_vehicle_id`) with an expiry — extend-only, never an explicit
off switch. G1 option B persists nothing beyond stamping those same columns. G2 removes
writes rather than adding them. G3's audit is user-owned operational data in Postgres.
Existing GPS consent is untouched.

### Observed constraints

- The Telegram widget is throttled to 30 seconds and renders only current SOC, odometer,
  state, speed, charging power/time-to-full, and optional last location. It does not need
  one-second history.
- PWA live views read `bydmate_live_snapshots`; a 5–10 second moving update and a
  30–60 second charging update satisfy the current 90-second live-SOC freshness rule.
- Raw samples currently also feed server-side trip inference, route tracks, detailed
  day/trip charts, SOH/energy diagnostics, and exports. Removing them in one cutover would
  change those features and risks missed trip-end events when the head unit powers off.
- The current APK writes a final client-trip block to its durable local queue before the
  confirmed `P → power off` flush attempt, then retries on a later app/daemon opportunity.
  The network flush is still best effort; G3 measures the actual server-accept delay.

### Data ownership and location — confirmation required before implementation

- **User-owned canonical data in Postgres:** authenticated live snapshot, validated trip,
  route track, charge session, server aggregate, command/notification state, and the
  finalization audit record. The cloud derives the Telegram and PWA read models.
- **Device-local delivery cache in Mate Room:** unsent events, a short raw diagnostic
  buffer, and provisional local trip calculations. It must survive process death but is
  never the only copy of cloud history.
- **No new user preference in this phase.** Existing GPS consent remains user-controlled;
  the client may omit GPS and the server continues to sanitize accepted points.

### What each surface actually needs

| Surface | Required cloud data | It does **not** require |
| --- | --- | --- |
| Telegram widget | latest snapshot and state transition; at most one edit per 30 s | every driving sample or full raw route |
| PWA live card | latest snapshot, fresh timestamp, SOC, speed/state, basic position | one-second cloud persistence |
| Charging screen | fresh SOC/power, four start-confirmation samples, start/stop edges, periodic progress | one-second bulk-charge samples below 98% |
| Trip list/analytics | final trip facts and hourly/daily aggregates | all raw points forever |
| Route map / detailed trip chart / diagnostics | adaptive geometry and bounded high-resolution samples | a fixed 1 Hz point on every straight road segment |

### Options

1. **Phased event contract with a shadow period (recommended).** First make trip-end
   delivery durable and remove unnecessary server fan-out. Then dual-write a v2 event
   stream beside the current samples, compare server-derived trips/charges, and only then
   reduce raw cloud persistence. This protects correctness and provides measured savings.
2. **Server-only micro-optimizations.** Gate notifications/widgets/auto-session queries
   and debounce activity writes without changing the payload. Low risk and useful, but it
   does not materially reduce storage or the number of parked/driving samples.
3. **Immediately upload only client daily/week/month summaries.** Lowest volume, but it
   loses routes and diagnostics, makes history depend on APK versions, and cannot reliably
   close a trip when the unit dies. Reject.

### Recommended target contract

- `live_state`: immediate state/gear/charging transitions; every 5–10 s while moving,
  every 30–60 s while actively charging, and an unchanged parked heartbeat no more often
  than every 5–15 min.
- `trip_segment`: adaptive 15–60 s or 100–250 m segment with odometer/SOC start/end,
  duration, speed/power/temperature extrema and averages, energy deltas, and a simplified
  route polyline. Emit earlier on turns, significant speed/SOC/power changes, or loss of
  GPS quality.
- `trip_end_candidate`: Room-first, high-priority event on park/ignition-off with a stable
  local trip id, end facts, last valid location, reason, sequence, algorithm version, and
  idempotency hash. Try a bounded flush; retry on the next APK or daemon opportunity.
- `charge_start`, `charge_progress`, `charge_end`: keep enough early samples to meet the
  four-confirmation auto-start rule, send every 30–60 s after confirmation, and send
  immediate plug/gun/SOC-boundary/tail/end edges. The cloud validates final session,
  energy, tariff, and cost.
- Keep a bounded local 1 Hz diagnostic buffer and retain raw cloud samples during the
  shadow period. High-resolution raw upload remains available for anomalies and explicit
  diagnostics; it is not the normal long-term protocol.

### Delivery roadmap

1. **P0 — reliable stop/off finalization — complete.** The current Mate client already has
   the durable final block, immediate flush attempt, and 20-minute next-boot recovery. G3's
   production audit now measures its first server acceptance; no duplicate protocol is planned.
2. **P1 — reduce current ingest fan-out.** Gate charge-notification work to charging
   changes, check widget eligibility/throttle before unrelated reads, debounce profile
   activity writes, and avoid full auto-session reads when no charging/open-session signal
   exists. No wire-contract change.
3. **P2 — v2 events in shadow mode.** Add event ids, sequence, algorithm version and
   idempotency validation. Upload `trip_segment`/end events alongside existing samples;
   compare distance, SOC, start/end, and track fidelity per trip.
4. **P3 — measured cutover and retention.** Reduce ordinary raw persistence only when
   parity thresholds hold. Keep adaptive route points and short diagnostic retention;
   retain cloud aggregates and final facts for all supported history views.

### Design-review gates before P2/P3

1. **Separate freshness from history.** `live_state` must update the latest snapshot but
   not automatically append a historical raw row. Every v2 event declares its server
   persistence class: snapshot-only, canonical segment/final fact, or bounded diagnostic
   raw. Without this distinction, lower upload cadence only moves the cost problem rather
   than solving it.
2. **Finalization is a candidate, not unilateral authority.** The server accepts a
   `trip_end_candidate` only when it matches the active vehicle/trip context, its odometer
   and timestamp do not regress, and it is not contradicted by newer driving telemetry.
   Otherwise it records the audit event and uses the existing grace/gap fallback. This
   prevents a transient `P` or delayed replay from splitting a physical drive.
3. **Order and retry contract.** Add `source_session_id`, monotonic `sequence`, immutable
   `event_id`, and payload hash. The server deduplicates `event_id`, never regresses a live
   snapshot from an older sequence/device time, and permits a late historical segment only
   when it belongs inside an already accepted trip window.
4. **Explicit stale/offline semantics.** A missed parked heartbeat must make the snapshot
   stale after a defined TTL; it must never imply that the car is still driving. The PWA
   and Telegram output should show last-seen/offline state from timestamps rather than
   inventing a vehicle state.
5. **Shadow window and rollback.** Run v1 and v2 side-by-side for a fixed, measured cohort
   and period. Compare per-trip start/end, distance, SOC, energy, route deviation, and
   finalization delay. Keep the v1 sender selectable until the acceptance thresholds pass;
   then stop dual write before reducing raw retention.
6. **Failure test matrix.** Cover no-network queueing, duplicate replay, out-of-order
   replay, `drive → P → power off` in under two seconds, daemon-only recovery, app restart,
   charging start/stop, GPS omitted, and an APK upgrade across an unfinished trip.

### Success measures

- No lost or incorrectly open trip across the `drive → P → power off` test matrix.
- Telegram freshness stays within its 30-second throttle; PWA moving live state ≤10 s and
  charging SOC ≤90 s.
- Compared with today's normal path: roughly 5–10× fewer moving live writes, 3–6× fewer
  bulk-charge writes, and up to 10–30× fewer unchanged parked writes, while route and
  trip/charge parity remain within defined tolerance.
- No client-provided aggregate bypasses RLS, tariff/cost calculation, notification state,
  or canonical trip/session validation.

Proposed 2026-07-15; not built. **Should I build this?**

---

## Public-documentation hygiene: English-primary, no private operations or AI material

### Goal

Turn the tracked documentation into a safe public product/developer reference. English
is canonical for implementation; Russian translations may remain public. Remove private
operational detail, agent/AI workflow material, local paths, real deployment/vehicle
history, and provider/model configuration from the public Git history going forward.
Keep any information needed by the local maintainer only in Git-ignored local files,
with **no public links or references to those files**.

### Audit facts (2026-07-15)

- `.gitignore` already ignores `/docs`, `AGENTS.md`, `CLAUDE.md`, `SKILLS.md`, and agent
  configuration folders, although older versions of several of those files are tracked.
- Publicly tracked AI/agent material currently includes `AGENTS.md`, `CLAUDE.md`,
  `SKILLS.md`, `PAPERCUTS.md`, agent-oriented sections in `README.md` and architecture
  docs, plus implementation/provider references to OpenAI, Ollama, Qwen, prompts, and
  agent memory in `BACKLOG.md`/`CHANGELOG.md`.
- Publicly tracked private operational material includes real production history,
  vehicle aliases and observations, self-hosted migration commands, local filesystem
  paths, hardware/ADB operational details, and deployment troubleshooting. It is spread
  across `BACKLOG.md`, `CHANGELOG.md`, `supabase/MIGRATIONS_AUDIT.md`,
  `supabase/TELEMETRY.md`, and related domain documents.
- `docs/ARCHITECTURE.ru.md` is a public Russian translation. It may remain tracked; the
  English `docs/ARCHITECTURE.md` remains the canonical implementation reference.

### Options

1. **Full public/private split (recommended).** Keep only concise English public docs:
   product overview, safe setup with placeholders, architecture, behavior contracts, and
   schema/API references stripped of real environments and AI/provider detail. Remove
   tracked agent instructions, work logs, backlogs, papercuts, operational runbooks, and
   historical deployment notes. Preserve their local copies under ignored `docs/` paths,
   but do not mention them in public files. Keep public Russian translations aligned with
   their English canonical counterparts.
2. **Redact only obvious secrets and hostnames.** Smaller diff, but internal operations,
   personal history, AI workflow, and implementation clues remain public. Does not meet
   the requested clean public-repo boundary.
3. **Make the repository private.** Avoids immediate redaction but leaves the current
   public-documentation posture unsafe if it is later opened or cloned. It also does not
   create a clean shareable repository.

### Recommended public scope

- Keep and rewrite with English canonical versions (and public Russian translations where
  present): `README.md`, `INSTALL.md`,
  `docs/ARCHITECTURE.md`, `docs/CHARGING_SESSIONS.md`, `docs/TRIPS.md`,
  `docs/DATABASE_SCHEMA.md`, `docs/PREMIUM_ADMIN.md`, `docs/PRODUCT_STATUS.md`,
  `docs/VEHICLE_STATE_NOTIFICATIONS.md`, `supabase/VOLTFLOW_MATE_API.md`, and a compact
  `supabase/TELEMETRY.md`. They will use generic examples/placeholders and describe
  product behavior without private operations or AI/provider details.
- Remove from the tracked public repository and keep locally only: `AGENTS.md`,
  `CLAUDE.md`, `SKILLS.md`, `PAPERCUTS.md`, `BACKLOG.md`, `CHANGELOG.md`,
  `docs/CHART_OPTIMIZATION_SPEC.md`, and `supabase/MIGRATIONS_AUDIT.md`. Move needed
  local content into ignored files before removal; no surviving public document may link
  to them.
- Remove all AI-related documentation from public files: agent workflows and model/tool
  references, plus provider-specific product-search documentation and environment keys.
  Public docs may say only that an optional search feature exists, without naming or
  documenting AI providers, models, prompts, embeddings, or keys.
- Remove real production/car/local details: domains, hosts, IPs, local absolute paths,
  exact car aliases/observations, production migration/deploy commands, hardware access
  procedures, internal bot operations, and incident records. Retain safe protocol names,
  endpoint paths, and placeholder credentials where necessary for public integration.

### Local-only ownership and location

The private copies are maintainer-owned operational documentation stored under ignored
`docs/` paths. They remain outside Git and outside public navigation. No user preference
or product data model changes are involved.

### Verification

- Inspect the tracked file list after the split; no removed AI/agent/private document may
  remain tracked or be linked from a public document.
- Search tracked Markdown for AI/provider terms, local paths, real hosts, production
  commands, credentials, and known vehicle aliases; allow only intentional generic API
  placeholders and public product vocabulary.
- Confirm the remaining public Markdown is English or an intentional Russian translation;
  retain reciprocal language navigation for public translations.
- Run `git diff --check`, link checks for remaining public docs, and verify ignored local
  copies are not staged.

Proposed 2026-07-15; not built. **Should I build this?**

---

## Telegram community marketplace for `@Voltflowscr_bot` — only search/matching, expiry, and a pre-filter remain

### Status check (2026-07-16) — verified against live production data, this is final

This entry was wrong three times in a row before this correction (see `CHANGELOG.md`
history). Verified this time not just against source but against **live behavior**:
queried the last 10 real messages from the BYD group (chat id `-1002179930838`,
"Купи и езди на BYD YUAN UP (Беларусь)") and every one shows `status: "processed"`
with correct `intent`/`needs_review`/`actionable` and `verified_at` landing 3–7 s after
`sent_at`. **The full pipeline is live and working right now.**

**Already shipped, fully operational — do not re-propose:**
- `community_listings` + `telegram_group_events` Postgres tables (migrations
  `20260714150000`, `20260714153000`, `20260714160000`, `20260715100000`).
- Admin CRUD: `src/lib/supabase/community-listings.ts` + admin navigation UI.
- **The entire capture → classify → draft pipeline runs in
  `scripts/telegram-miniapp-server.py`** (the Python edge Telegram's webhook actually
  calls at `https://bot.voltflow.life/voltflow/api/telegram/webhook` — confirmed via
  `getWebhookInfo`), not in the Next.js tree at all:
  - `handle_webhook()` → `normalize_group_event()` → `upsert_telegram_group_event()`
    (status `pending`) → spawns `process_telegram_group_event()` on a background thread.
  - `process_telegram_group_event()` calls `verify_telegram_text()` (a Python twin of
    `verifyTelegramContext`, same `LLM_BASE_URL`/`LLM_MODEL`/`LLM_API_KEY` env vars);
    on `actionable: true` it calls `upsert_community_listing()`, which **does** insert
    into `community_listings` with `status: "draft"` (upserts on
    `source_chat_id, source_message_id`, so edits refresh the same listing).
  - `process_pending_group_events()` exists as a batch retry/backfill path for rows
    stuck at `status: "pending"`.
  - The Next.js `src/lib/llm-context-verifier.ts` and
    `src/app/api/telegram/webhook/route.ts` are unrelated to this flow (the latter only
    handles `/start`/`/app` for direct bot chats).

**Genuinely still open:**
1. **No deterministic pre-filter.** `process_telegram_group_event()` calls the LLM
   unconditionally for every non-empty, non-protected message — no cheap keyword gate
   first. Not a correctness bug (classification is working), but every message in an
   active group costs an LLM call. Worth a keyword pre-check (`продам`, `куплю`, `ищу`,
   `нужен`, price/contact patterns) to skip obviously-irrelevant technical chatter
   before calling `verify_telegram_text()`.
2. **Search/matching integration missing.** No `market_listing` source type in the
   vector-search contract — confirmed via full-tree grep, zero hits. Buyer/seller
   matching by embedding + generation/city/status/expiry filters is unbuilt.
3. **Expiry.** No cron/RPC expires `community_listings` after 30 days; `expires_at`
   exists as a column but nothing acts on it. (`telegram_group_events` has its own
   7-day `expires_at` for the raw inbox, also with no prune job found.)

### Recommendation

None of the three remaining items are urgent — the marketplace works end-to-end today
for the core "message becomes a moderated draft listing" loop. Priority, if picked up:
item 1 (pre-filter) first since it's the only one with an ongoing cost/latency impact;
items 2–3 whenever search/discovery for listings is actually wanted.

### Data ownership (unchanged, now reflects the fully built schema)

- **Normalized listing:** user-owned, Postgres (`community_listings`), author-editable
  via the existing admin CRUD.
- **`telegram_group_events`:** app-owned raw capture + verification result storage,
  already applied — treat as the working system, not something to redesign.
- **Embeddings:** app-owned derived search data, to be deleted with the listing once
  item 2 exists.

Should I build any of the three remaining items, or leave this alone for now?

---

## 🟠 Domain migration → voltflow.life — leftovers (optional, not blocking)

Phases 0–3 **shipped** (canonical domain, frontend URLs, backend infra, and the Mate
one-shot settings migration built + verified on car `way`) — see [CHANGELOG.md](CHANGELOG.md).
The two Mate commits (`7b37366` vehicle_id fix, `e2cd59b` domain migration) are **local,
unpushed** — a formal Mate release still follows the `/release-apk` skill (version bump +
post-install telemetry verification).

Remaining items are optional and none block anything:

- **Serve `/api/bydmate/*` directly on the old host.** Today every telemetry sample is a
  `308` + a re-issued POST. Flipping `volt-flow-beige.vercel.app` to *Connect to an
  environment → Production* and moving the redirect into `src/proxy.ts` with a path
  exemption would halve the request count. Efficiency, not correctness.
- **Vercel Attack Challenge Mode is intermittently ON** (`x-vercel-mitigated: challenge`),
  which challenges every non-browser client. It is the reason Telegram traffic detours via
  `bot.voltflow.life`. A WAF bypass for `/api/bydmate/*` would be healthier than routing
  around it.
- **Push subscriptions are origin-scoped.** A user who reinstalls the PWA from the new
  origin gets a *second* subscription → possible duplicate charge notifications until the
  old one expires. Worth a dedupe pass.
- **No `sitemap.ts` / `robots.ts`** — the marketing + knowledge pages have no canonical host
  declared for SEO.

---

## 🟡 Knowledge base content gaps (two missing articles)

The 12-query relevance eval (`npm run search:eval`) passes 12/12 — but two of those pass by
*correctly admitting we have no answer*:

- **«как заряжать зимой»** — the corpus has no winter-charging article. The closest match is
  *Зимняя омывающая жидкость* (winter washer fluid, 0.417), which is why search used to hand
  it over as an answer.
- **«чем отличается AC от DC»** — no AC-vs-DC explainer exists.

Both are questions a real BYD owner will certainly ask. The search side is now handled (it
says "Точного ответа не нашлось" instead of bluffing), so **this is a content task, not a
code task**: writing the two articles turns both cases from "honest miss" into "hit".

**Verified 2026-07-15 — don't write from scratch, there's a false start to reuse or
delete:** `src/data/charging-explainer.ts` already has entries titled "AC vs DC charging"
and "Winter charging behavior" (dated 2026-05-16, predates this backlog item). It has
**zero importers anywhere in the tree** — it was never wired into the searchable
`knowledge_articles` corpus the eval script tests against, so the eval's "missing" verdict
is still accurate for actual search results. Before writing new copy, read this file first:
either promote its content into `knowledge_articles` (fastest path) or confirm it's
unusable and delete the dead file instead of leaving orphaned content behind.

When they exist, flip their `expect` in `scripts/knowledge-search-eval.mjs` from `null` to
the new titles — the eval will then hold them to the same standard as everything else.

Optional, and deliberately deferred: **hybrid search** (vector + Postgres full-text, RRF
fusion). It is the textbook cure for "matched one adjective, ignored the topic". But at 19
documents with a 10/12 top-1 hit rate, the measurement says retrieval is not the bottleneck
— content is. Revisit if the corpus passes ~100 items or the eval regresses.

Proposed 2026-07-14; content work, no go-ahead needed from an engineering standpoint.

---

## 🟡 Separate car model from generation and choose model-specific dashboard art

The `cars` table currently stores only `model_generation` (`gen1_2024` or
`gen2_2025`), which is insufficient for users with Yuan Plus, Dolphin, Seal, or
another vehicle. The dashboard image mapping therefore cannot safely distinguish a
Yuan UP from another model.

**Options:**

1. Add a `model_key` column to `cars` with a constrained app-supported enum, default
   existing rows to `yuan_up`, expose the model selector in the car form, and map
   dashboard art by `model_key` while keeping generation separate — explicit,
   backwards-compatible, and safe for future model images.
2. Infer the model from the user-entered nickname — no migration, but unreliable and
   would show incorrect artwork for names like “Family car”.
3. Keep Yuan UP art for every car — no code or schema work, but misleading for every
   non-Yuan-UP vehicle.

**Recommendation:** option 1. Add an idempotent migration for `cars.model_key` with
   `yuan_up` as the existing-row default, define the allowed model keys in shared
   TypeScript, add localized model labels and a required Settings/car-form selector,
   and use a generic car icon when a model has no image. Keep `model_generation`
   independent because generation applies within a model. Existing RLS remains
   user-scoped; verify the migration, create/update flows, dashboard fallback, and
   localized settings labels before applying it to production.

Proposed 2026-07-12; awaiting go-ahead.

---

## 🟡 Lifetime-map pagination: race-safety vs. round-trip latency

`fetchLifetimeTrackPoints` (`src/lib/vehicle-analytics.ts`) pages through
`bydmate_trip_track_points` via `collectPagedRows` (`src/lib/bydmate/paged-query.ts`),
issuing up to 5 sequential `range()` requests for the default 5,000-point cap (shipped
2026-07-11 to fix the 414 error for long histories — see CHANGELOG). Code review
(2026-07-11) flagged two related issues neither fixed nor urgent enough to block:

1. **Offset drift under concurrent writes:** pages are ordered `device_time desc` with
   numeric `range(from, to)` offsets. If the vehicle is actively driving while the map
   loads, a new track point can land between page fetches and shift every later row's
   offset by one — a boundary row can appear duplicated or a row can be silently
   dropped, showing as a small jog/gap on the rendered polyline. The old single-query
   snapshot didn't have this window.
2. **Sequential round trips reintroduce latency:** 5 awaited-in-order requests instead
   of 1, for exactly the long-history vehicles the 414 fix targeted — risk of a slow
   response or Vercel timeout with no `maxDuration` override on the route.

**Options:**
1. **Keyset (cursor) pagination** — page by `.lt("device_time", lastSeenCursor)`
   instead of numeric offsets. Fixes the drift issue outright (immune to concurrent
   inserts above the cursor) but stays sequential, so it doesn't address latency.
2. **Fire all pages in parallel** (page count is known upfront: `ceil(limit/pageSize)`)
   — fixes latency (~1 round trip instead of 5) but narrows, doesn't eliminate, the
   drift window, and changes `collectPagedRows`'s short-circuit-on-short-page contract
   (would need a rewrite of its existing tests).
3. **Both:** parallel keyset pages aren't compositable (each cursor depends on the
   previous page's last row), so getting both properties needs a different design,
   e.g. a single server-side RPC that snapshots the page.
4. **Leave as-is** — the drift is a rare, cosmetic map glitch; the latency risk is
   real but unmeasured (no report of an actual timeout yet).

**Recommendation:** option 1 (keyset) first if the map glitch is ever reported by a
real user; otherwise leave as-is and revisit if `/api/vehicle/lifetime-map` shows up
slow in practice. Not urgent — awaiting go-ahead.

Related, same review pass: `collectPagedRows` itself isn't reused by the two
pre-existing hand-rolled pagination loops in `src/lib/bydmate/telemetry-history.ts`
and `src/lib/charging-session-reconcile.ts`. Worth migrating those to the shared
helper the next time either file is touched, not as a standalone task.

---

## 🟡 Partition `bydmate_telemetry_samples` by time (Plan A)

The high-volume ~1 Hz append-only table. Retention is `DELETE`-based (bloat + vacuum
pressure). **Plan B (BRIN index) is done** (see CHANGELOG). **Plan A (full declarative
range partitioning by `device_time`, monthly)** turns retention into `DROP PARTITION`
and shrinks indexes.

- Forces composite PK `(id, device_time)`; the existing unique
  `(user_id, vehicle_id, device_time)` already includes the partition key. ✅
- Subtle part: the prune rewrite — mixed retention tiers (free 30 d vs premium/admin
  forever) in one time partition means a hybrid of `DROP PARTITION` (past the longest
  tier) + per-user `DELETE` within retained partitions.
- Annotated, **not-applied** draft: [docs/PLAN_A_PARTITION_DRAFT.sql](docs/PLAN_A_PARTITION_DRAFT.sql).
- Needs user go-ahead **and** a pg_dump/host backup before applying.

Not urgent at current scale; worth doing before the userbase grows.

---

## 🔵 Promote `vehicle_id` to a real foreign key

`vehicle_id` is a soft `text` key across telemetry, trips, snapshots, commands, and
notifications (~36 occurrences), linked by `cars.vehicle_alias` (text) → `*.vehicle_id`
(text) string equality with **no referential integrity**. A typo or alias change
silently orphans data.

**Recommendation:** a real `vehicles` table (uuid PK), FK from all telemetry/trip/command
tables, keeping `vehicle_alias` as the external device id. Big, multi-RPC migration on
the hottest write path (ingest) — defensible to defer until the telemetry tables are
already being opened up (e.g. combine with the partitioning cutover above). Lower
priority than partitioning; build only if explicitly prioritized.

---

## ⚠️ APK: no-ADB basic mode — verdict REVISED 2026-07-06 (varies by firmware)

> **2026-07-06 correction:** a real user's **Yuan UP 2025 / DiLink 5** ran the v0.4.6
> «Диагностика BYD» button: `/storage/emulated/0/energydata/EC_database.db` **EXISTS**
> (876 rows, `canRead=true`, DiPlus not running, no ADB), and the APK's existing importer
> had already pulled **873 trips into its local DB**. So `energydata` presence **varies by
> firmware/model-year within Yuan UP** — the owner's car lacks it, the 2025 car has it.
> Basic mode is viable on such cars; the ⛔ below stands only for cars without the file.
> → The trip-summary cloud sync plan below is now **justified by a real user**.

### Original investigation (2026-07-02, owner's car)

Investigated adopting AndyShaman's no-ADB `energydata` read. **Dead end on the Yuan UP** —
verified on car `way` via ADB:

- `/storage/emulated/0/energydata/EC_database.db` (AndyShaman's source) **does not exist**
  on the Yuan UP — it's Leopard-3-only. `EnergyDataReader.kt` already reads it; nothing to
  read on this model.
- di+ `van_bm_db` (`/storage/emulated/0/vandiplus/db/van_bm_db`) has rich trip+charging
  history and a reader (`DiPlusDbReader`), but di+ only **writes** it when di+ works —
  which needs ADB. No ADB → empty.

**Conclusion:** on DiLink 5 there is no no-ADB source; ADB is required for any data. Docs +
onboarding reverted from "basic mode coming soon" to "ADB required." No APK work to do
unless a future model ships the `energydata` DB. See [[adb-data-source-reality]].

**Clarification vs upstream README (2026-07-05):** AndyShaman's no-ADB basic mode is real
but rests entirely on the `energydata` file — and per his own architecture table, live
SOC/temps/SoH/cells come from the **autoservice Binder under shell (ADB)** even upstream.
Basic mode ≠ live cockpit anywhere; it's trips/consumption + GPS only. His car (Leopard 3)
writes `energydata`; the Yuan UP doesn't.

---

## 🟠 Delivery cadence vs the Vercel free plan — cut invocations, not calculation

### Goal

Keep VoltFlow on Vercel's free plan. The binding resource is **function invocations**, and
invocations are driven by **delivery cadence**, not by how much arithmetic runs per sample.
Owning sources are APK-side: `CommandDaemon` and `CloudTelemetrySender` in `BYDMate-own`.

**Data ownership:** no user-facing data model changes. These are app-owned cadence constants
compiled into the APK; nothing moves between Postgres and client storage.

### Research findings — 2026-07-20

**The cloud-offload programme optimised the wrong resource for this goal.** Measured on prod:
the self-hosted database is **3.04% CPU / 386 MB**, the database is **1.17 GB**, and the fleet's
entire per-sample ingest work is ~11 minutes of DB time per week. Phases 3–4 save 0.68 ms/sample
(3.255 → 2.575 ms, 20.9%) on a resource that is free and idle. **They do not reduce invocations
at all** — the same HTTP requests are made, with less work inside them.

Vercel bills **Active CPU**, not wall-clock, so time spent waiting on the database is cheap.
Invocation count is the countable. Bandwidth is not a concern: 835 bytes/sample average against
~30,200 samples/day is roughly 1.5–2.5 GB/month versus a 100 GB allowance.

Requests per hour by state, derived from the documented cadences:

| State | Delivery interval | Requests/hour |
| --- | --- | --- |
| Parked / car-off heartbeat | 60 s | 60 |
| Charging bulk (<98%) | 60 s | 60 |
| Driving | 15 s | 240 |
| Charge tail (≥98%) | 15 s | 240 |
| **Fast mode (viewer watching)** | **3 s** | **1,200** |

```
invocations/day ≈ 240·(driving_h + tail_h) + 60·(parked_h + charging_h) + 1200·viewer_h
```

Measured fleet total is **5,675 invocations/day ≈ 172k/month** (telemetry route only). The naive
model predicts ~9,600/day, so not every car runs a daemon continuously — treat the model as an
upper bound.

**Ranking correction:** fast mode is the most expensive *per hour* by a wide margin, but the
parked heartbeat likely contributes as much or more *per day*, because it runs ~20 hours instead
of one. An earlier claim in this session that fast mode was the main multiplier was wrong on
daily totals.

### Options

1. **Do nothing.** *Pro:* no freshness cost. *Con:* invocations stay at ~172k/month with no
   headroom as the fleet grows. **Correct choice if the dashboard shows you are well under quota.**
2. **Parked/daemon delivery 60 s → 300 s (recommended).** 60 → 12 requests/hour, up to **960
   fewer requests/day per car**; plausibly 40–50% fleet-wide, ~172k → ~90k/month. *Cost:* the
   live snapshot may be up to 5 minutes stale **while parked and nothing is changing** — which is
   precisely the condition `live_only` already asserts. Viewer-gated fast mode covers the case
   where someone is actually looking.
3. **Driving 15 s → 30 s.** Halves 240 → 120/hour. *Cost:* real freshness loss for a non-watching
   viewer. Do only if option 2 is insufficient.
4. **Fast mode 3 s → 5 s.** 1,200 → 720 per viewer-hour. *Cost:* degrades the headline feature
   users actually see. Last resort.

### Recommendation

**Check the Vercel dashboard Usage page first.** If 172k/month is a small fraction of the
allowance, build nothing — the region pin already shipped is the right stopping point. Only if
headroom is tight, build option 2 alone and re-measure before considering 3 or 4.

### ✅ Dashboard checked 2026-07-20 — answer is "headroom is gone", and the model above was wrong

Vercel Usage, Jul 6 23:00 – Jul 20 (14 days), projected ×2.14 to a 30-day month:

| Metric | 14 days | Projected/mo | Hobby limit | Status |
| --- | --- | --- | --- | --- |
| Function Invocations | 721K | ~1.55M | 1M | 🔴 155% |
| Edge Requests | 736K | ~1.58M | 1M | 🔴 158% |
| Fluid Active CPU | 5h 29m | ~11.7h | 4h | 🔴 293% |
| Fluid Provisioned Memory | 175.5 GB-Hrs | ~376 GB-Hrs | 360 | 🟠 104% |
| Fast Origin Transfer | 2.06 GB | ~4.4 GB | 10 GB | 🟢 44% |
| Fast Data Transfer | 2.07 GB | ~4.4 GB | 100 GB | 🟢 4% |
| ISR Reads / Writes | 6.5K / 699 | negligible | 1M / 200K | 🟢 |

So the "build nothing" branch is dead. But the more important result is that **the cadence model
in this entry accounts for only ~11% of the bill.**

- This entry measured the telemetry route at **5,675 invocations/day**.
- Actual total is **721K / 14 = ~51,500 invocations/day**.
- **~45,800/day — roughly 89% — is not the telemetry route at all.**

**The missing 89% is almost certainly the command poll.** `CommandDaemon.kt:47` sets
`BASE_POLL_MS = 6000L` on a dedicated thread, and the comment at `CommandDaemon.kt:304` states it
is held at that interval **regardless of fast mode**. A continuously running daemon is therefore
`3600/6 × 24 = 14,400 invocations/day/car`, independent of driving/charging/parked state. The
residual divided by that is ~3.2 continuously-polling car-equivalents out of eight cars — a good
fit. `GET /api/bydmate/commands` is also not as cheap as its own comment claims: every poll runs
**three** database round trips (`resolveBydmateApiKeyProfile`, the
`enqueue_due_vehicle_command_schedules` RPC, then the select), even when the queue is empty.

This repeats the exact category error already recorded above for the cloud-offload programme: the
poll was optimised for *Postgres* cost (one indexed read, zero writes) while being the dominant
consumer of the resource that is actually metered (*invocations*).

**Attribution caveat:** the 89% split is inferred from the deterministic poll arithmetic, not read
off a per-route breakdown. Observability Events shows **0**, so the Hobby dashboard cannot break
usage down by route. Confirm before building — see P0 below.

### Revised options — the command poll is now the primary lever

Ranked by invocations removed per unit of user-visible cost:

- **P0 — Confirm the attribution.** Log a counter per route for 48h, or compare the
  `/api/bydmate/commands` count against `/api/bydmate/telemetry` in Vercel's function view. Cheap,
  and everything below depends on it. Do not build blind.
- **P1 — Fold command delivery into the telemetry POST response (recommended).** The daemon
  already POSTs telemetry; return any pending commands in that response and keep a slow
  independent GET (60 s) purely as a floor for the car-off/no-telemetry case. Removes the 6 s poll
  as a separate invocation entirely: **~14,400 → ~1,440/day/car (−90%)**. Command latency then
  tracks the telemetry cadence, which is already fast exactly when it should be (driving, charging,
  fast mode) and slow only when parked with nobody watching. *Risk:* must not re-serialise the two
  network calls on the daemon's status thread — AGENTS.md records that serial round trips were the
  measured cause of 8–9 s status latency. Commands ride the *response* of a POST that already
  happens; the standalone floor poll stays on its own thread.
- **P2 — Adaptive poll interval.** Keep the separate poll but run it at 6 s only when a fast-mode
  window is live or the app-alive beacon is fresh, and 60 s otherwise. Smaller change than P1,
  ~−80% on idle cars, but leaves two request paths where one would do.
- **P3 — Parked telemetry 60 s → 300 s** (option 2 above). Still worth doing, but it now targets
  the ~11% slice, not the bulk. Sequence it after P1.
- **P4 — Serve `/api/bydmate/*` on the old host directly.** Already listed under "Domain migration
  → leftovers": every telemetry sample is currently a `308` plus a re-issued POST. Edge Requests
  (736K) sitting fractionally *above* Function Invocations (721K) is consistent with a redirect on
  a hot path. Halves edge requests for the telemetry path at no freshness cost.
- **Rejected — long-polling the command channel.** Holding the request open would cut invocations
  but bills wall-clock **provisioned memory**, which is already at 104% of quota. It trades a
  red metric for a redder one.

### The honest alternative: Vercel Pro

Three metrics are over on a fleet of eight cars. P1 + P3 plausibly gets invocations to ~200–300K/mo
and Active CPU proportionally down, which restores real headroom. But every lever here spends
either APK release cycles or user-visible freshness, and the fleet upgrades gradually (four of
eight cars on 0.5.0 as of 2026-07-20), so relief arrives over weeks while the overage is now.
**Vercel Pro at $20/mo removes the constraint immediately and buys time to do P1 properly rather
than urgently.** Recommend deciding this explicitly rather than defaulting to "stay free" — the
engineering time to hit the free tier is worth more than $20/mo unless staying free is a goal in
itself.

Dashboard data supplied by owner 2026-07-20; revised plan awaiting go-ahead.

### Risks

- **Edge-triggered pushes must remain immediate.** The daemon already reports gun connect/
  disconnect straight away and wakes at 6 s even when unwatched. Only the *idle rhythm* may
  stretch to 300 s. If an edge push were folded into the slower rhythm, charge-start
  notifications would be delayed by up to 5 minutes — a user-visible regression.
- **Do not touch the 15-minute forced-full rule** (`LIVE_ONLY_MAX_RUN_MS`). Phantom-drain
  analytics (`bydmate_phantom_drain_daily`) discards gaps ≥ 6 h, and that rule is what keeps
  stored parked samples ~15 min apart. Changing *delivery* interval does not affect it — queueing
  and the forced-full rule are separate — but a careless edit here would silently break
  `idle_hours`.
- **Two senders.** `CloudTelemetrySender` (app alive) and `CommandDaemon` (car off) are
  independent and the daemon builds its own payload; a fix in one is not a fix. Car-off is where
  parked actually lives, so the daemon is the one that matters most here.
- Requires an APK release and fleet upgrade to take effect — four of eight cars are on 0.5.0
  as of 2026-07-20, so the benefit arrives gradually.

Proposed 2026-07-20; awaiting go-ahead.

---

## 🟠 Ingest-time offload counters — make the cloud-offload savings measurable

### Goal

Record, per vehicle per day, how much per-sample server work the client-side offload actually
avoided, so the value of phases 2–4 and the readiness of Phase 6 are observable instead of
argued. Owning sources: `src/app/api/bydmate/telemetry/route.ts` and a new small table.

**Data ownership:** these are **app-owned operational metrics**, not user data and not user
preferences — no client-side storage question arises. They live in **Postgres**, aggregated per
vehicle per UTC day, and carry no telemetry values, only counts.

### Why retrospective measurement cannot work (established 2026-07-20)

Attempted first; it fails for three independent reasons, all worth recording so nobody retries it:

1. **`live_only`'s saving is absent rows.** Phase 2 suppresses the history write entirely, so the
   saved samples never reach `bydmate_telemetry_samples`. You cannot count what was never
   written, and the cars upgraded at different times so there is no clean before/after.
2. **The Phase 0 state classifier is confounded for this purpose.** `speed <= 0.5 and not
   charging → parked` counts stop-and-go driving (1 Hz at traffic lights) as parked, which
   produced an impossible 178–420 "parked rows/hour" against a 30 s heartbeat's 120/h ceiling.
   The classifier is correct for gross state share, its original Phase 0 job, and wrong here.
3. **No matched comparison exists.** Isolating genuinely stationary hours (max speed 0, not
   charging) left exactly one car with ≥5 such hours in 7 days, and it was an old-APK car.

The facts needed are all known **at ingest time** — `route.ts` already parses `live_only`,
`client_hourly`, `client_trip` per sample and knows `hourlyBlocks.length` / `tripBlocks.length` —
and are then discarded.

### Options

1. **Do nothing.** *Pro:* zero cost. *Con:* the offload programme's value stays unmeasured and
   the Phase 6 gate keeps relying on version counts rather than on how much work old clients
   still cause.
2. **Counters table, one upsert per request (recommended).** New
   `bydmate_ingest_counters (user_id, vehicle_id, day_utc, …)` upserted once per HTTP request
   with counts derived from the already-parsed payloads: samples seen, `live_only` suppressed,
   `client_hourly` folded, `client_trip` tagged, hourly/trip blocks applied. *Pro:* directly
   answers "what did the offload save", feeds the existing admin Phase 6 view, and costs **one
   write per request, not per sample** — batches currently average 2.7–11.5 samples, so roughly
   one extra write per ~5 samples against the 5 writes/sample it measures. *Con:* it is still a
   new write on the hot path, and a new table.
3. **Structured logs only.** `console.log` the same counts and read them from Vercel. *Pro:* no
   schema at all. *Con:* short retention, not queryable historically, cannot feed the admin gate
   — fine for a spot check, useless as a trend.
4. **Per-sample path column on `bydmate_telemetry_samples`.** *Rejected:* adds a write and
   storage to the 954 MB table this whole programme exists to relieve.

### Recommendation — option 2

- Migration: `bydmate_ingest_counters`, PK `(user_id, vehicle_id, day_utc)`, integer columns
  `samples_seen`, `live_only_suppressed`, `client_hourly_samples`, `client_trip_samples`,
  `hourly_blocks_applied`, `trip_blocks_applied`, plus `updated_at`. Written only through a
  `SECURITY DEFINER` RPC (`bydmate_record_ingest_counters`) doing a single additive upsert;
  `IF NOT EXISTS`-idempotent per the self-hosted rule.
- `route.ts`: derive the counts from `payloads` (already in memory), fire the RPC **best-effort**
  in its own promise alongside the existing rollup calls — logged on failure, never failing the
  request, never part of ack accounting.
- **Log the failure path explicitly.** The v0.4.9 status ping shipped fire-and-forget with no
  logging and cost a whole test cycle to diagnose; do not repeat that here.
- Derived metrics (trips closed with `client_trip`, and therefore `bydmate_finalize_trip_energy`
  scans avoided) come from `bydmate_trips` and need no counter.

### Risks

- **It adds work to the path being optimised.** One write per request is small relative to the
  5 writes/sample it measures, but it is not free; if invocation cost dominates, prefer option 3.
- **Additive counters are not retry-safe** — a retried request double-counts. Acceptable for a
  diagnostic (the error is bounded by the retry rate and these are trend numbers, not billing),
  but it must be stated in the column comments so nobody later treats them as exact.
- Backfill is impossible for the same reasons the retrospective analysis failed; the series
  starts empty and only becomes useful as the remaining cars upgrade.

### Related finding worth acting on separately

The two fast-mode cars (`way`, `BYD`) show 4.4 and 2.7 samples per batch against 8.4–11.5
elsewhere — `way` at 10,602 HTTP invocations versus `cl`'s 1,455. **Viewer-gated fast status is
pushing invocation count up on exactly the cars where the offload pushed database work down.**
If Vercel invocations rather than Postgres write load are the real cost driver, those two
features are working against each other and the trade needs deciding on numbers. These counters
would make that visible too.

Proposed 2026-07-20; awaiting go-ahead.

---

## Notes / smaller debt

- **Overlapping tariff columns on `profiles`:** legacy `default_price_per_kwh` coexists
  with `home/commercial_ac/fast_dc_price_per_kwh`. The legacy column could be retired.
- **`numeric` for telemetry** that doesn't need exact decimals — `real`/`double precision`
  would be smaller/faster (lat/lon already use `double precision` — inconsistent).
- **Client `isJunkTrip` vs server discard** are out of sync (server is authoritative);
  sync Rules B/C into `trip-filter.ts` only if phantoms surface in the UI. See
  [docs/TRIPS.md](docs/TRIPS.md).

---

## ~~VPS service audit — retire dead tenants on the Supabase host~~ — PARTLY SHIPPED 2026-07-21

> Shipped: immich vhost removed, expired `mykid.ddns.net` cert deleted (certbot dry-run now fully
> green), `caddy` disabled, failed states cleared, 7 GB of Docker images/cache pruned.
> **Corrected during execution:** `/opt/immich` is **20 GB of live photo library data** (4,445 media
> files), not an app directory — the deletion proposed below was withdrawn and the data kept.
> `/opt/ai-gateway` retained at owner's request. See [CHANGELOG.md](CHANGELOG.md).
>
> **Still open:** (a) whether to retire `chat_agent` — its bot has been down 5 weeks on an
> `ImportError` typo (`get_persona_prompt_project_path` vs `get_persona_prompt_path`) and its
> database is **completely empty** (0 users / 0 messages / 0 conversations, 7.8 MB), so it is a
> one-line fix or a clean delete; (b) whether `cadvisor` (~0.2–0.5 core, 4d01h CPU in 26 days) backs
> any dashboard — still unproven, `sqlite3` is unavailable in the Grafana container; (c) whether to
> restore or retire immich itself, given the data is intact but its images were pruned.

### Goal

Reduce what runs on the 3-vCPU Contabo box that hosts production Supabase, after the
`ai-gateway` shutdown. Audited read-only 2026-07-21.

### Correction to the ai-gateway recovery claim

The CHANGELOG entry cites load average 3.05 -> 1.98. **Load average was the wrong metric.**
Re-measured 20 minutes later it is back to **3.11** — but CPU is **57-70% idle** versus **9.4%
idle** before the fix, and user CPU is **18-23%** versus **54.7%**. The fix worked; Linux load
average on this box counts short-lived runnable and D-state tasks (6,400-7,400 context
switches/sec across ~740 tasks) and is not a CPU-saturation signal here. **Judge this host by
`%idle`, not load average.**

### Findings — dead or unneeded

| Item | Evidence | Cost |
| --- | --- | --- |
| `/opt/immich` + `nginx sites-enabled/immich` | **Zero immich containers exist.** vhost still enabled | **21 GB** disk; vhost `proxy_pass`es to `127.0.0.1:8000`, now owned by `supabase-kong` |
| `/opt/ai-gateway` | service disabled 2026-07-21 | **2.7 GB** disk (TensorFlow venv) |
| `caddy.service` | **enabled + failed**, no journal entries; nginx is the real proxy | redundant proxy that could contend for :80/:443 on reboot |
| `chat_agent_bot` | **exited (1) five weeks ago** | its `chat_agent_postgres` still runs (1% CPU, 41 MB) serving a dead consumer |
| `certbot.service` | fails on `mykid.ddns.net` only | VoltFlow certs are healthy to **Oct 12 2026**; the stale cert keeps the unit red so a *real* renewal failure would look identical |
| Docker images/cache | `docker system df` | **12.11 GB** reclaimable images, 824 MB volumes, 1.97 GB build cache |
| Prometheus jobs `Offtech-NextCloud`, `mariadb-nextcloud` | no nextcloud on this host | dead scrape targets |
| `f1-news-bot-f1-news-telegram-1` | **unhealthy 12 days**; sibling leaks the 436 zombie curls | not VoltFlow's to fix |
| `ModemManager`, `iscsi`, `vmtoolsd` | cellular-modem / iSCSI / VMware agents on a KVM VPS | trivial CPU, but pointless |

**Biggest live consumer is now `cadvisor`** — 20-53% of a core, **4d01h accumulated CPU** over 26
days. Prometheus does scrape it. Whether any dashboard or alert *uses* `container_*` metrics is
**unproven** — `sqlite3` is unavailable inside the Grafana container, so the UI-created dashboards
in `grafana.db` could not be checked. Do not drop it on the filesystem grep alone.

**Disk is not under pressure:** 63 GB used of 387 GB (17%). Cleanup is hygiene, not urgent.

### Options

1. **Safe sweep (recommended).** Remove the immich vhost + `/opt/immich`, delete `/opt/ai-gateway`,
   `systemctl disable --now caddy`, `systemctl reset-failed ai-gateway caddy`, remove
   `chat_agent_bot` + its Postgres, drop the stale `mykid.ddns.net` cert so certbot goes green,
   `docker image prune -a`. *Gain:* ~36 GB disk, a truthful certbot signal, one less proxy that can
   fight nginx for :443, and the removal of a vhost pointing at Supabase's own port. *Risk:* low —
   all targets are already dead. Confirm immich and chat_agent are genuinely abandoned first.
2. **Sweep + investigate cadvisor.** As above, plus prove whether `container_*` metrics back any
   dashboard/alert; if not, drop cadvisor for ~0.2-0.5 core. *Risk:* losing container dashboards.
3. **Do nothing.** *Con:* the immich vhost keeps pointing at `supabase-kong`, and certbot stays
   permanently red.

### Recommendation

**Option 1 now** (no VoltFlow dependency, all targets already dead), then option 2's cadvisor
question separately once dashboard usage is confirmed. Leave the f1-news and chat_agent
*applications* alone beyond the exited container — they belong to other projects.

Proposed 2026-07-21; awaiting go-ahead.

---

## 🟡 Dashboard "Walk to my car" button — pedestrian handoff to the phone's maps app

### Goal

Add a button below the existing Dashboard content (after `DashboardDeferredSummaries`,
before the `Dialog`) that hands off the vehicle's last known GPS point to the phone's
native maps app for walking directions from the user's current position to the car.
Grilled via `/grill-with-docs` (2026-08-06); every point below is a confirmed decision,
not an open option.

### Research findings

- **The fallback logic this needs already exists**, inline in `LocationCard`
  (`src/components/vehicle/vehicle-live-view.tsx:1657-1753`, rendered on the separate
  `/vehicle` page, not the Dashboard): live snapshot location when fresh, else the last
  trip's final GPS track point (`useLatestBydmateTripsQuery` + `useBydmateTripTrackQuery`).
- **Exact GPS has a hard 24h ceiling for every tier**, not just free. Migration
  `20260720150000_security_gps_retention_and_mate_key_hash.sql`
  (`purge_old_bydmate_telemetry_by_tier()`) zeroes `bydmate_live_snapshots.location` after
  24h **unconditionally** — the `is_user_premium` tier check that protects other tables in
  the same function does not apply to this update. So the live-location half of the
  fallback chain is time-boxed regardless of plan; the last-trip fallback is what carries
  the feature past that window.
- **No existing turn-by-turn maps deep-link in the codebase.** The one precedent
  (`settings-view.tsx` `TariffLocationMapPreview`) links to the OpenStreetMap web viewer
  (a static map, not routable directions) — not reusable for this.
- **Platform detection already exists**: `isIos()` / `isStandalone()` in `src/lib/pwa.ts`,
  already consumed by `install-prompt.tsx` and `start-tracking-button.tsx`.
- **Relative-time formatting already exists**: `formatTimeAgo` (`src/lib/time-ago.ts`) is
  already imported into `dashboard-view.tsx` for an analogous "how long ago did the car
  report" caption (line 758).
- **The base trip-history hooks live in `src/hooks/`**
  (`use-bydmate-trips-query.ts`, `use-bydmate-trip-track-query.ts`), which is where the new
  shared hook belongs.

### Decisions (confirmed in the grilling session)

1. **Location source**: live snapshot (fresh ≤24h) → fallback to the last trip's final
   track point → else no location. Extract this out of `LocationCard` into a shared hook
   `useVehicleLastKnownLocation(vehicleId)` in `src/hooks/use-vehicle-last-known-location.ts`;
   refactor `LocationCard` to consume it instead of duplicating the resolution logic in two
   places (the project's own two-senders lesson in AGENTS.md: a fix in one copy is not a
   fix).
2. **No location at all** → hide the button entirely; no disabled state.
3. **Deep link, platform-branched via the existing `isIos()`**:
   - iOS → `https://maps.apple.com/?daddr={lat},{lon}&dirflg=w`
   - else → `https://www.google.com/maps/dir/?api=1&destination={lat},{lon}&travelmode=walking`
4. **No `navigator.geolocation` permission requested.** Both URLs above resolve "current
   location" as origin inside the native maps app itself once opened; the app only ever
   needs the destination coordinates it already has.
5. **Hidden while the vehicle is in driving mode** (via the existing
   `deriveDashboardVehicleMode`), in addition to rule 2 — guiding someone to a car they are
   currently driving is nonsensical.
6. **Staleness caption shown**, reusing `formatTimeAgo` + the existing
   `timeAgoSeconds/Minutes/Hours` i18n keys, labeled by source ("last seen" for live vs.
   "from last trip" for the fallback) so the user can judge trust before tapping through.
7. **Label**, matching the app's existing terse verb-first copy (`dashboard.addVehicle`
   "Add vehicle", `dashboard.startCharging` "Start charging") and its "авто" noun choice
   across locales:
   | Locale | Label |
   | --- | --- |
   | en | Walk to my car |
   | be | Дайсці да аўто |
   | ru | Дойти до авто |
8. **Visual weight**: secondary/outline button, matching `charging.checkAgain` /
   `dashboard.signIn`'s existing `variant="outline"` rounded-pill treatment — not the
   primary gradient CTA style (`dashboard.addVehicle`), since this is a convenience
   shortcut, not the dashboard's primary action.
9. **Placement**: new section after `DashboardDeferredSummaries`
   (`dashboard-view.tsx:1414-1428`), before the `Dialog` (line 1432).

### Data ownership and location

No new data model, no new Postgres column, no `localStorage`. Fully read-only against
existing app-owned vehicle telemetry (`bydmate_live_snapshots.location`,
`bydmate_trip_track_points`) — already governed by the existing RLS and 24h/tiered
retention rules, unchanged by this feature. The destination URL is built client-side from
that data and handed to the OS in one shot (`window.location`/anchor `href`); nothing is
written anywhere. This differs from the tariff-location case in AGENTS.md's past-rework
warning — that was new user-preference data needing an ownership decision; this reads an
existing telemetry field and persists nothing new.

Proposed 2026-08-06; awaiting go-ahead. **Should I build this?**

---

## Frontend hosting: stay on Vercel, or move to the Contabo VPS alongside Supabase?

### Goal

Decide whether the Next.js frontend should be co-located on the self-hosted Supabase VPS.
The question arose from two pressures: the "status must reach PWA/WEB/TELEGRAM/TGWIDGET almost
immediately" goal, and the Vercel Hobby quota overage recorded in the delivery-cadence entry
above. Investigated read-only 2026-07-21.

### Research findings

**Topology.** Frontend is on Vercel pinned to `fra1` (Frankfurt) via `vercel.json`. The Supabase
VPS `144.91.127.194` (`vmi3078244.contaboserver.net`) geolocates to **Lauterbourg, Grand Est,
France** — roughly 120 km from Frankfurt, same European backbone.

**Co-locating cannot improve live-status latency. Two independent reasons:**

1. **The live path does not traverse Vercel at all.** The PWA and widget subscribe to Supabase
   Realtime `postgres_changes` straight from the browser — `src/hooks/use-bydmate-live-query.ts:81`,
   `src/hooks/use-vehicle-commands-query.ts:45`,
   `src/components/charging/charging-session-screen.tsx:197`. Traffic goes browser → VPS directly.
   Moving the Next.js server changes nothing on this path.
2. **The one hop Vercel does sit on is already negligible.** Car → `fra1` → Supabase in
   Lauterbourg costs single-digit milliseconds on the Vercel→DB leg. Per AGENTS.md the measured
   status budget is **~3 s** (daemon push) to **5–9 s** (app path), dominated by daemon loop
   pacing and batch delivery. Saving ~10 ms against ~5,000 ms is unmeasurable.

**The VPS has no spare capacity, and it is not a VoltFlow-only box.** Measured 2026-07-21:

| Resource | Reading |
| --- | --- |
| CPU | 3 vCPU, load average **3.05–3.28** — fully saturated |
| CPU breakdown | 54.7% user, 34.0% sys, **9.4% idle**, 0.0% iowait (real CPU, not I/O stall) |
| Memory | 7.9 GB total, 4.4 GB used, **3.5 GB available** |
| Disk | 387 GB total, 63 GB used (17%) — ample |

The box also runs `amnezia` (WireGuard VPN), `f1-news-bot` (+ its own Postgres and Redis),
`chat_agent_postgres`, `uptime-kuma`, `hellomate-bot`, Grafana/Prometheus/Loki/cadvisor, and
`ai-gateway`. Supabase is one tenant among many.

**Root cause of the saturation — an unrelated crash loop (see the dedicated entry below).**
Summed container CPU is under 25%, so the load is not Supabase. It is `ai-gateway.service`
restarting forever and reloading TensorFlow each time.

### Options

1. **Stay on Vercel, fix invocations at the source (recommended).** The overage is caused by the
   6 s command poll, not by hosting location — see the delivery-cadence entry's P1 (fold command
   delivery into the telemetry POST response, ~-90% invocations) and P4 (drop the `308` on
   `/api/bydmate/*`, free). *Pro:* keeps CDN, preview deploys, managed TLS, autoscaling; fixes the
   actual cause. *Con:* P1 needs an APK release cycle and the fleet upgrades gradually.
2. **Vercel Pro, $20/mo.** *Pro:* removes the constraint today, buys time to do option 1 properly
   rather than urgently. *Con:* recurring cost. Already recommended in the entry above.
3. **Hybrid — move only `/api/bydmate/telemetry` and `/commands` to the VPS.** These are ~100% of
   the invocation problem. A Deno skeleton already exists at `supabase/functions/bydmate-telemetry/`.
   *Pro:* removes the billing driver, keeps Vercel for user-facing pages. *Con:* the Deno path has
   **minimal validation only** — no auto-session, reconcile, or charge notifications — so this is a
   real port of `src/app/api/bydmate/telemetry/route.ts` (452 lines), and it duplicates ingest logic
   across two runtimes, which AGENTS.md already flags as a recurring source of bugs in the
   two-sender case. Also needs CPU the box does not currently have.
4. **Full migration of the frontend to the VPS — not recommended.** *Pro:* no invocation billing;
   one deployment target. *Con:* zero latency benefit (findings above); the box is at ~90% CPU
   before adding a Node server plus builds; collapses app and database into a single failure
   domain on one unredundant VPS; loses CDN, preview deployments, managed TLS and autoscaling;
   adds reverse-proxy, process-supervisor, and deploy-pipeline ops burden.

### Recommendation

**Do not move the frontend.** The premise that co-location improves freshness does not hold — the
live path already bypasses Vercel entirely, and the remaining hop is ~10 ms against a ~5 s budget.
Treat hosting and the quota overage as separate problems: take **option 2 now** ($20/mo, immediate)
and **option 1 (P1 + P4)** as the durable fix. Revisit option 3 only if the invocation count stays
over quota *after* P1 ships, and only once the VPS has real CPU headroom.

Proposed 2026-07-21; awaiting go-ahead.

---

## 🟡 Negative-SOC sentinel: Postgres guard shipped 2026-08-10, root cause still open

> **Status update 2026-08-10.** The sibling issue in this same investigation — a charging
> session closing `completed` short of target on stale math — **shipped and is verified
> working**: commit `1e4ca70` (2026-08-07 21:25, `feat(charging, telemetry): enhance
> session completion logic and sanitize negative SOC readings`) added
> `resolveAutoCompletionProgress()` (`src/features/charging/_server/charging-session-auto-complete.ts`),
> which refuses to complete a session unless server-measured progress has actually reached
> target. Verified against prod 2026-08-10: **zero** sessions have completed short of
> target since the fix deployed (previously 1 of 76). See CHANGELOG.md 2026-08-07. The one
> pre-fix row (`debd8803-2e96-4de1-af90-2c677db9d205`) is still uncorrected — repairing it
> is a separate data-repair decision, not yet made.
>
> The *same commit* also shipped `sanitizeDiplusSoc()` in
> `src/lib/bydmate/telemetry-sanitizer.ts`, intended to fix this entry. **It does not work
> in production.** Re-verifying this entry 2026-08-10 found the leak continuing past the
> fix, so this entry stays open with the new evidence below, promoted to 🟠 since it now has
> a confirmed-ineffective fix rather than just an open question.

### Finding (updated)

`bydmate_telemetry_samples.diplus_soc = -1` continues after the fix commit: **56
occurrences since 2026-08-07 18:25 UTC** (the fix's deploy time), as recent as **this
morning, 2026-08-10 07:17 UTC** (`Bulbazavr`). Original finding (379 occurrences across 9
vehicles since 2026-05-23) is unchanged in nature, just now known to persist post-fix.

### Root-cause trace — the fix targets a field that isn't the one actually written

Traced the full data path from JS sanitizer to the persisted column, live against prod:

1. `sanitizeDiplusSoc()` operates on `item.payload.diplus.soc` and deletes the key when out
   of `{min:0,max:100}`. Confirmed correct in isolation — its own test
   ("drops the DiPlus negative SOC sentinel without discarding valid telemetry") passes, and
   a focused run of both new test files is 10/10 green.
2. The sanitized `diplus` object flows unmodified as `p_diplus` into RPC
   `bydmate_ingest_telemetry` (`src/app/api/bydmate/telemetry/route.ts:247-263`), which
   builds `v_diplus := coalesce(p_diplus, '{}'::jsonb)` and — for non-`live_only` samples —
   calls `bydmate_apply_diplus_columns('public.bydmate_telemetry_samples'::regclass, ...,
   v_diplus, ...)`.
3. That function (read live via `pg_get_functiondef`) sets
   `diplus_soc = public.bydmate_jsonb_numeric($2, 'soc')` where `$2 = v_diplus` — i.e. it
   reads exactly the field the JS layer is supposed to have already stripped.

**So the SQL trace is airtight and the JS fix's own logic is correct — yet -1 still lands
in the column.** That means either (a) the affected traffic never goes through
`sanitizePayloadTelemetry` at all, or (b) something rebuilds/duplicates `diplus.soc` after
sanitization runs, before the RPC call. (a) is more likely given the project's documented
"two senders"/two-ingress-path pattern (AGENTS.md): confirmed the Supabase Edge Function
at `supabase/functions/bydmate-telemetry/index.ts` is, in the *repo*, a pure proxy to the
Next.js route (converted 2026-07-23, predates this fix) — so if it is actually deployed
and NOT stale, it should not bypass sanitization. Ruled out Vercel deploy staleness as the
cause: `vercel ls` shows deployments continuing normally through and after the fix commit,
and the *sibling* fix in the same commit (the completion guard, pure Next.js code) is
confirmed working in prod, so the Next.js deployment is current. **Not yet checked:**
whether the Android Mate app (`BYDMate-own`, a separate repo) calls the Supabase RPC
directly via a Postgres/PostgREST client for some code path, bypassing the Next.js route
(and therefore all JS-side sanitization) entirely — this is the leading remaining
hypothesis and needs the Android source, which isn't in this repo.

### Options

1. **Check the Android Mate app for a direct-to-Supabase ingest path (recommended first
   step).** If some APK version/path posts straight to
   `.../rest/v1/rpc/bydmate_ingest_telemetry_batch` instead of `/api/bydmate/telemetry`,
   sanitization needs to move server-side (into `bydmate_apply_diplus_columns` itself, or a
   `CHECK`/trigger on `bydmate_telemetry_samples`) so it can't be bypassed by any client.
   This matches the project's existing lesson that a fix in one sender is not a fix.
2. **Move the `-1` guard into Postgres regardless of root cause.** Add the range check
   directly inside `bydmate_jsonb_numeric` (or a `CHECK (diplus_soc IS NULL OR diplus_soc
   BETWEEN 0 AND 100)` constraint) so it holds for every ingress path, present and future,
   independent of which sender is at fault. *Pro:* closes the hole regardless of cause,
   defense-in-depth the project already leans on elsewhere (self-hosted `search_path` bugs,
   RLS). *Con:* doesn't explain *why* -1 is arriving, so option 1 is still worth doing to
   understand blast radius (is this only these ~9 vehicles' traffic, or could other invalid
   diplus fields be leaking the same way?).
3. **Leave it.** Same as originally: low but nonzero blast radius (56 occurrences across at
   least 5 vehicles in under 3 days), and now a *known-ineffective* fix sitting in the
   codebase, which risks someone believing this is already handled.

### Recommendation

Do both 1 and 2, in that order — 2 is cheap defense-in-depth and closes the hole
immediately regardless of what's found; 1 explains why the JS-layer fix (which is correct
code, just not on the path this traffic takes) didn't help, and matters for deciding
whether other JS-side telemetry sanitization has the same blind spot.

### ✅ Option 2 shipped 2026-08-10

Migration `20260810120000_guard_diplus_soc_range.sql`: `bydmate_apply_diplus_columns`
now clamps `diplus_soc` to `NULL` whenever the parsed value falls outside `0–100`, via a
`CASE` around the existing `bydmate_jsonb_numeric($2, 'soc')` read — same function serves
both `bydmate_telemetry_samples` and `bydmate_live_snapshots`, so both are covered by one
change regardless of which sender is responsible. Applied to self-hosted prod via `psql -f`
(the CLI can't reach the pooler over TLS). Verified: `pg_get_functiondef` on prod shows the
new `CASE` expression live. This closes the hole even though the root cause (which sender
bypasses the Next.js sanitizer) is still unknown.

**Also applied 2026-08-10:** session `debd8803` (see the sibling entry above) was
backfilled to its live-SOC-correct values — `current_percent: 100`,
`charged_energy_kwh: 22.55`, `estimated_cost: 8.2156415` (was 95.898% / 20.249 kWh / 7.377
BYN) — computed from the same `energyNeededKwh`/`energyFromGridKwh`/`costFromGridEnergy`
formulas the app itself uses (51%→100% on a 45.1 kWh pack at 98% efficiency,
0.36433 BYN/kWh).

### Still open — option 1

The Postgres guard is a backstop, not an explanation. Nobody has confirmed *why* -1 was
reaching the RPC despite the JS sanitizer being correct and tested — the leading hypothesis
(the Android Mate app calling the Supabase RPC directly for some code path, bypassing
`/api/bydmate/telemetry` and all JS-side sanitization) still needs the `BYDMate-own`
Android source, which isn't in this repo. Worth doing if other JS-side telemetry
sanitization might have the same blind spot, but no longer urgent — the column can no
longer carry the bad value regardless of the answer.

### Data ownership and location

No new data model. Same as originally: a validation change to existing app-owned ingest
(`bydmate_telemetry_samples`, `bydmate_apply_diplus_columns`) in Postgres.

Postgres guard + data repair shipped 2026-08-10; root-cause investigation (option 1) still
awaiting go-ahead if wanted.

---
