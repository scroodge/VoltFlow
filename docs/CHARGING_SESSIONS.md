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

- a positive charging signal such as `charge_power_kw`;
- the vehicle is parked or moving slowly;
- four consecutive charging samples within the permitted time window;
- a vehicle alias matching the authenticated telemetry stream.

Traction `power_kw` is not a charging signal. An explicit unplug state overrides a stale
charging flag.

The server backdates an automatic start from the last suitable non-charging reading or
the first charging sample. It never takes the confirming sample as the real start when
earlier evidence exists.

An open session stops after consecutive non-charging samples or immediately after a
confirmed drive-away. A stop timestamp can never precede its start timestamp.

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
(`src/actions/session-corrections.ts`). Only energy/cost/price are editable — SOC and
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

## Verification

The focused tests cover charging-signal interpretation, automatic start/stop logic, and
session reconciliation:

```bash
npm run test
```
