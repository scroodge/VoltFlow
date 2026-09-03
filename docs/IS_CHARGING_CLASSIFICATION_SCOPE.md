# `is_charging` classification disagreement

Status: investigation and scope only; no implementation is included.

## Executive finding

The incorrect producer is the daemon's normal Di+ payload path. It declares charging when
either `chargingStatus > 0` **or** gun state is in `2..5`. Production shows that
`chargingStatus = 1` can persist while gun state is explicitly `1` (unplugged), charge
power is zero, the vehicle is stationary and powered off, and SoC is declining. In that
state `chargingStatus > 0` is not evidence of active charging.

The app and autoservice-only fallback use the gun-state whitelist `2..5` and classify the
observed gun-state-1 samples as not charging. The resulting interleaving produces the raw
true/false flap.

Severity is **medium for telemetry correctness, currently low for demonstrated server
analytics impact**. The bad value is common and the legacy server trip path consumes it,
but the aux-voltage, phantom-drain, charging-session, and notification paths already have
guards that neutralize this exact gun-state-1/zero-power contradiction. No production
repair is justified by the measured evidence.

## 1. Producer conditions

### Foreground APK

`VehicleTelemetrySnapshot.from` chooses the autoservice gun value when available, otherwise
the Di+ gun value:

```kotlin
val gunState = charging?.gunConnectState ?: data?.chargeGunState
val isCharging = gunState?.let { it in setOf(2, 3, 4, 5) }
```

`CloudTelemetryPayload` writes that `snapshot.isCharging` value. Cadence classification
also treats Di+ as charging only when `chargeGunState in 2..5`; its non-Di+ fallback accepts
an explicit snapshot flag or absolute charging power above 0.1 kW.

For the observed state (`gun = 1`), this path emits false.

### Daemon normal Di+ path

`CommandDaemon.buildTelemetryPayload` uses:

```kotlin
val isCharging = (d.chargingStatus != null && d.chargingStatus!! > 0) ||
    (gun != null && gun in 2..5)
```

This is the disagreement. During the sampled overnight sequence, every true row has flat
`diplus_charging_status = 1` and gun state `1`; false rows have gun state `1` and no positive
charging-status value. With zero charge power and declining SoC, the normal daemon's
`chargingStatus > 0` branch is wrong for active-charging semantics.

### Daemon autoservice-only fallback

`CommandDaemon.buildAutoserviceFallbackPayload` reads autoservice FID
`FID_GUN_CONNECT_STATE` and uses only:

```kotlin
val isCharging = gun != null && gun in 2..5
```

It also sets `is_parked = !isCharging`. It does not use BMS state or `chargingStatus > 0`
to assert charging. For gun state `1`, it emits false and agrees with the foreground APK.

The fallback eligibility check (`lastKnownGear == P || gun in 2..5`) decides whether a
safe parked/charging fallback may run; it is not itself the emitted `is_charging` value.

## 2. Downstream consumers

### Resting 12 V and phantom drain: protected

Both `bydmate_aux_voltage_daily`/its materializer and `bydmate_phantom_drain_daily` call
the shared production predicate:

```sql
speed_kmh <= 0.5
and abs(power_kw) <= 0.1
and not case
  when charge_power_kw > 0 then true
  when gun_state = '1' then false
  else is_charging
end
```

The explicit gun-state-1 branch was added specifically so stale normalized
`is_charging=true` cannot suppress parked idle time. Therefore the observed alternating
raw Boolean does **not** split the two-hour resting window and does not split the four-hour
phantom-drain window. The daily materialized aux rollup calls the same predicate rather
than duplicating it.

For the sampled vehicle, the completed 2026-08-31 rollup still produced
`v_resting = 12.4 V` from 45 qualified samples despite the overnight flap. The sampled
vehicle has a non-null resting value on all 30 completed rollup days in the measured
30-day range.

### Automatic charging sessions and charge notifications: protected

An automatic session can start only when measured `charge_power_kw > 0.1 kW` while parked.
The contradictory rows have zero/absent charge power, so they cannot open a session.
Production has **zero** charging sessions in the last 30 days whose `started_at` sample
matches the contradiction.

Keeping an existing session alive may use `is_charging`, but only after real charge power
and an explicit gun-state check: gun state `1` returns false. The zero-power stall supplies
an additional five-minute close condition. Charge notifications use the same real-power-
first, explicit-unplug guard. Thus this exact flap neither starts phantom sessions nor
keeps notifications in charging state.

### Trip finalization: exposed legacy path

The server trip reducer's non-client path computes charging as normalized
`is_charging=true`, positive charge power, or a textual Di+ charging status. It does not
apply the explicit gun-state-1 override. A bad daemon row can therefore take its charging
branch and close an open server-owned trip.

Modern APK samples carry client-owned trip rollups, where the APK's cadence/trip plan uses
the gun whitelist and normally closes the trip at the real park transition before sparse
sleep telemetry. Daemon samples do not carry client trips. This greatly limits exposure,
but does not prove the legacy path harmless: production still contains 1,429 server-owned
versus 1,737 client-owned trips started in the last 30 days. A bounded production query
could not reliably attribute a historical trip end to one later contradictory sample
within the read-only statement timeout, so actual trip corruption is **not established and
not ruled out**.

### Other historical charging consumers

Charging-history display accepts `is_charging` only inside an already-open session and
also rejects it when gun state is explicitly `1`. Charge-end delta queries use the Boolean
or charge power only within an already identified charging-session window; the bad rows
cannot create that window. Aux min/max voltage is state-independent; only the resting
median uses parked classification, which is protected as above.

## 3. Production frequency and demonstrated impact

Read-only queries covered the last 30 days of retained production through 2026-09-01.
The contradiction was defined narrowly as:

- `is_charging = true`;
- gun state `1`;
- speed at most 0.5 km/h;
- absolute traction power at most 0.1 kW;
- charge power zero/absent; and
- power state off/zero or absent.

Results:

- **7,688 contradictory rows**;
- **7 of 14 configured vehicles** affected;
- earliest measured row 2026-08-02, with affected rows continuing through 2026-09-01;
- affected-vehicle row counts were 1,957, 1,731, 1,335, 1,297, 571, 492, and 305;
- the sampled vehicle contributed 1,957 rows.

For the specific sampled sleep window, 16:44:08Z–05:30:14Z, there were 100 history rows:
45 true, 55 false, and **83 true/false transitions**. SoC declined from approximately
85.3% to 83.3%. This is sustained flapping, not an isolated malformed sample.

The fleet-wide count is a count of provably contradictory rows, not a claimed exact number
of transition edges. Computing a full ordered lag over the multi-million-row fleet table
exceeded the read-only statement timeout; the sampled vehicle transition count above is
the directly measured flap rate.

Demonstrated downstream impact:

- aux/resting sample misclassification from this exact contradiction: **zero**, by the
  gun-state-1 override; the sampled vehicle produced its expected completed-day resting
  result;
- phantom-drain sample misclassification: **zero**, because it calls the same predicate;
- charging sessions started from contradictory samples: **zero in 30 days**;
- charging keep-alive/notification misclassification: neutralized by the same explicit
  unplug guard;
- trip mis-finalization: possible in the legacy server-owned reducer, but not measurable
  conclusively from retained production within the safe query limit.

The fact that 110 of 312 fleet rollup rows in the last 30 days have no resting median does
not demonstrate this bug: the predicate classifies the contradictory rows as parked, so
changing their raw Boolean would leave those rollup classifications unchanged.

## 4. Fix placement and history

### Recommendation

Fix **both boundaries**, with one semantic rule: active charging requires real positive
charge power, or a connected gun state that is not contradicted by explicit unplug state;
`chargingStatus > 0` alone must not override gun state `1`.

1. **APK/daemon source fix (required):** remove the daemon-only
   `chargingStatus > 0 || ...` disagreement and centralize the classifier shared by the
   foreground, normal daemon, and autoservice fallback. Tests must cover gun=1/status=1/
   zero-power as false, real positive charge power as true, and gun 2..5 behavior.
2. **Server canonicalization (recommended defense):** centralize the already-proven
   real-power/gun-state precedence and use it for ingest fan-out, especially the legacy
   trip reducer. Do not maintain separate subtly different charging predicates for aux,
   phantom drain, sessions, notifications, and trips. Preserve genuine charging when
   measured charge power is positive even if the sampled car reports gun state `1`.

An APK-only fix leaves older clients and the legacy server trip path exposed. A server-only
fix leaves contradictory raw/live telemetry and cadence decisions on the head unit. Both
are warranted, but they should be separately testable changes.

### Historical repair

Do **not** rewrite raw telemetry or charging sessions based on current evidence:

- aux and phantom-drain classification already produces the same result the corrected
  Boolean would produce;
- materialized aux rollups therefore do not need recomputation for this issue;
- no charging session was observed to start from the contradiction;
- raw telemetry has bounded retention and remains useful evidence of producer behavior.

Before considering any trip repair, build a dedicated audit that replays the legacy trip
state machine with the corrected predicate and reports exact changed trip boundaries. Do
not infer or mass-edit trip ends from temporal proximity alone.

## Severity

**Medium.** The producer bug is common across half the configured fleet and creates an
objectively false raw state. The highest-priority 12 V resting and phantom-drain analytics
are protected and measured production shows no charging-session starts caused by it, so
this is not currently a high-severity analytics incident. The unresolved legacy trip-path
exposure and misleading live/raw state justify fixing it rather than merely documenting it.
