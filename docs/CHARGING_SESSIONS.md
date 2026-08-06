# Charging sessions

This document defines the public behavior of `charging_sessions`. See also
[telemetry storage](../supabase/TELEMETRY.md).

## Ownership and writers

| Source | Responsibility |
| --- | --- |
| User in the PWA | Starts/stops sessions and writes live progress while the charging screen is active. |
| Vehicle telemetry ingest | Creates or closes automatic sessions; it does not write per-second progress. |
| Reconciliation | Repairs inconsistent closed sessions from persisted vehicle telemetry. |
| Provider correction | Replaces a finished session's energy/cost with user-entered, provider-billed figures. See below. |
| Manual entry | Creates a whole session the ingest pipeline never detected, from receipt figures. See below. |

Telemetry history is append-only. Session progress is shared through the normal
authenticated data channel.

## Source-of-truth priority

For SOC, energy, and cost, use:

```text
fresh live SOC (up to 90 seconds) > in-session telemetry > time-based estimate
```

Time-based math is a fallback for display and persistence only. It must not replace fresh
vehicle data or complete a session while fresh live SOC is available.

## Automatic session detection

Automatic charging detection requires all of the following:

- `charge_power_kw > 0.1 kW`, or the compatible `is_charging` fallback when Di+ does not
  explicitly report an unplugged gun;
- the vehicle is parked (`speed_kmh ≤ 5`);
- four consecutive charging samples in the recent three-minute ingest window;
- a vehicle alias matching the authenticated telemetry stream.

Traction `power_kw` is not a charging signal. An explicit unplug state overrides a stale
charging flag, and the 100% balance tail does not start a new session.

The server backdates an automatic start to the first charging sample. It uses the last suitable
idle SOC when that reading is at most 30 minutes old and no greater than the first charging SOC;
otherwise it uses the first charging sample's SOC. It never takes the confirming fourth sample as
the real start when earlier evidence exists.

An open session stops after two consecutive non-charging samples or immediately after a
drive-away above 5 km/h. A stop timestamp can never precede its start timestamp.

## Energy and cost

Energy and cost are derived from SOC, battery capacity, and a tariff-specific efficiency:

```text
battery_kwh        = (current_percent - start_percent) / 100 * battery_capacity_kwh
charged_energy_kwh = battery_kwh / (efficiency_percent / 100)
estimated_cost     = charged_energy_kwh * price_per_kwh
```

Battery capacity is stored per car. Efficiency is stored per tariff: a typical value is
about 98% for AC and 90% for fast DC. The BMS energy counter is diagnostic only and must
not calculate cost or the primary charging-power display.

## Reconciliation

Reconciliation repairs recent completed sessions when timestamps are invalid, stored
energy/cost conflicts with SOC-based grid energy, or a live telemetry maximum disproves a
time-only result. It uses vehicle telemetry rather than a previously persisted display
value.

## Provider corrections & learned efficiency

A finished session (`completed` or `stopped`) can be corrected with the provider's billed
kWh and total amount paid via `correctChargingSessionEnergy`
(`src/features/charging/corrections-actions.ts`). Only energy/cost/price are editable — SOC and
timestamps stay telemetry-derived, since they define the session's analysis window. The
correction:

- writes `charged_energy_kwh`, `estimated_cost`, and a derived `price_per_kwh` onto the
  session, and sets `energy_overridden = true` plus `energy_corrected_at` (this is the
  first runtime writer of `energy_overridden`; reconciliation already skips energy/cost
  writes on any session with that flag, so the correction is safe from being overwritten);
- inverts the energy formula above (`measuredEfficiencyForSession` in
  `src/lib/charging-efficiency-learning.ts`) to compute that session's measured
  efficiency, and snapshots average battery temperature, outside temperature, and charge
  power from the session's telemetry window into `charging_efficiency_observations` — at
  correction time, not lazily, because telemetry is purged by retention (see
  [telemetry storage](../supabase/TELEMETRY.md)) and would not survive to be recomputed
  later.

Observations are aggregated per car and per efficiency group (AC covers `home` +
`commercial_ac`, mapping to `cars.default_efficiency_percent`; `fast_dc` has its own
`cars.fast_dc_efficiency_percent`). `suggestEfficiency` surfaces a suggested value — the
median of the most recent 10 observations — only once there are at least 3 observations,
they agree within a 5-point spread, and the suggestion differs from the configured value
by at least 1 point. A suggestion is never applied automatically: it is shown with its
evidence (sample count, spread, average temperatures) next to the relevant field in car
settings, and the user applies it with `applySuggestedEfficiency`
(`src/actions/cars.ts`). Temperature/power context is stored for future analysis but does
not yet drive a temperature-bucketed model — v1 is one value per car per efficiency group.

## Manual entry for missed sessions

Automatic detection is deliberately conservative — four consecutive charging samples within
three minutes, vehicle parked, plausible gun state. When the Mate app is closed, the head
unit powers down mid-charge, or the gun state is misreported, a real charge produces **no
session row at all**. Provider correction cannot help there: it edits an existing row.

From the History tab's day view, "Add missing charge" opens a small form collecting only
what a receipt shows: **start time, end time, billed kWh, total paid**.

### Why fields are derived

`charging_sessions` requires `start_percent`, `current_percent`, `target_percent`,
`charger_power_kw` and `efficiency_percent` as NOT NULL, under
`check (start_percent < target_percent)`. A receipt has none of those, so
`deriveManualSessionFields` (`src/features/charging/_domain/manual-session.ts`)
reconstructs them:

| Field | Derived from |
| --- | --- |
| `charger_power_kw` | `billedKwh / durationHours`, clamped to `(0, 350]` |
| `tariff_type` | `resolveTariffTypeByPower(power)` — same band logic as a GPS-less auto session |
| `efficiency_percent` | `efficiencyPercentForTariff(car, tariffType)` — per tariff, not per car |
| SOC delta | `billedKwh × efficiency/100 ÷ battery_capacity_kwh × 100`, clamped to `[1, 100]` |
| `start_percent` | nearest telemetry SOC within ±10 min of the start time; `0` when none |
| `target_percent`, `current_percent` | `min(100, start + delta)`, sliding the window down if the gain would run past 100% |
| `price_per_kwh` | `totalCost / billedKwh` |
| `charged_energy_kwh`, `estimated_cost` | exactly as entered |
| `status` | `completed` |

Because the percent range is reconstructed rather than measured, the History cards show a
manual session's **SOC gain** (`+33%`) instead of a `start% → end%` pair. Presenting a
derived start and end as if telemetry had recorded them would be a lie the UI can't take
back.

### Two invariants

1. **`energy_overridden` is always set.** `sessionNeedsReconcile` returns false for such
   rows, so reconcile — which runs on every sessions-list load — leaves them alone. Without
   this the row would be recomputed from telemetry that was, by definition, too sparse to
   detect the charge in the first place.
2. **No efficiency observation is recorded.** Unlike `correctChargingSessionEnergy`, a
   manual entry writes **no** `charging_efficiency_observations` row. Its SOC delta was
   derived *from* the billed kWh using the configured efficiency, so feeding it back as a
   measurement would be circular and would corrupt learned efficiency.

An overlap guard rejects an entry whose window intersects an existing session for the same
car, since a duplicate would double-count in the day summary and every monthly total.

Manual rows carry `manual_entry = true`, which drives the "Manual" badge and scopes
`deleteManualChargingSession` — auto-detected sessions can never be deleted through it.

## Verification

The focused tests cover charging-signal interpretation, automatic start/stop logic, and
session reconciliation:

```bash
npm run test
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test src/features/charging/_server/auto-session.test.mjs
```

`charging-auto-session.test.mjs` is intentionally outside the `npm run test` glob, so both
commands are required when verifying automatic-session behavior.
