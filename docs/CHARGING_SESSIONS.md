# Charging sessions

This document defines the public behavior of `charging_sessions`. See also
[telemetry storage](../supabase/TELEMETRY.md).

## Ownership and writers

| Source | Responsibility |
| --- | --- |
| User in the PWA | Starts/stops sessions and writes live progress while the charging screen is active. |
| Vehicle telemetry ingest | Creates or closes automatic sessions; it does not write per-second progress. |
| Reconciliation | Repairs inconsistent closed sessions from persisted vehicle telemetry. |

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

## Verification

The focused tests cover charging-signal interpretation, automatic start/stop logic, and
session reconciliation:

```bash
npm run test
```
