# Trips (`bydmate_trips`) — ingest lifecycle & junk filtering

How driving trips are created, extended, closed, and filtered. Companion to
[CHARGING_SESSIONS.md](CHARGING_SESSIONS.md). Server logic lives in the
`bydmate_ingest_telemetry` SQL function; the client-side display filter lives in
`src/lib/voltflowmate/trip-filter.ts`.

## Lifecycle

Each telemetry sample drives a server state machine over the user's single open trip
(`ended_at is null`). This is the complete lifecycle for legacy APKs and daemon-only
samples, which are not tagged `client_trip`:

- **Open** — a sample with *drive evidence* (`v_is_drive_sample`: `speed_kmh > 5` **or**
  `gear ∈ {D, R, N}`) with no open trip creates a new `bydmate_trips` row.
- **Extend** — a drive sample within the 5-minute trip gap updates `last_device_time`,
  `sample_count`, `soc_end`, `max_speed_kmh`, `avg_speed_kmh`, and `distance_km`.
- **Close** — the trip closes when a sample shows charging, gear **P** (with the
  `speed ≤ 5` guard, migration `20260612120000`), or the 5-minute gap elapses. On close the
  row is run through `bydmate_discard_trip_if_junk`; survivors get `bydmate_finalize_trip_energy`.
- **Route-insight projection** — at transaction commit, every surviving closed trip with at
  least two GPS points refreshes one compact `bydmate_trip_insight_inputs` row. It contains
  the bounded representative track and the per-trip temperature averages already used by
  Route Insights. The deferred trigger runs after junk-trip deletion, so discarded rows
  have no projection; it moves this expensive derivation out of the interactive Analytics
  request without changing trip facts or GPS collection.

### Client-owned trip finalization (`client_trip`)

Modern Mate APKs send a cumulative `trips[]` block beside telemetry. A block has `ended_at`
only after the local trip is closed. The server applies that aggregate through
`bydmate_apply_client_trip`; a final block is idempotent, never reopens a trip, and is the
canonical recovery path for `drive → P → power off` when no final sample reached ingest.

The APK writes the final block to its durable local queue before shutdown, tries an immediate
flush on confirmed `P → power off`, and retries it on the next app or daemon opportunity. Its
next-boot finalizer closes a stale local trip after 20 minutes. The 5-minute server gap close
is deliberately skipped for a `client_trip` row, because it could close an active client-owned
trip while later cumulative blocks are still arriving. It remains the fallback for legacy APKs
and untagged daemon traffic.

A final client-owned trip also reaches the same deferred route-insight projection trigger when
its `ended_at` is accepted. It therefore has the same compact route data when it contains GPS,
while summary-only inputs with no track remain absent from route analytics.

`bydmate_trip_finalization_audits` records the first server acceptance of each final client
block (not an HTTP attempt): client end time, server acceptance time, and delivery delay. It
contains no GPS or raw payload, is visible only to its owner through RLS, and is retained for
30 days for every account tier. Normal `P → power off` delivery targets under two minutes;
recovery up to 20 minutes is expected.

### `distance_km` is a per-trip delta from the car trip meter (since `20260615120000`)

Ingest stores `trip_meter_baseline_km` = `current_trip_distance_km` at trip open and writes
`distance_km` as **meter_now − baseline** (with mid-trip reset handling via
`bydmate_trip_distance_from_meter`). This fixes inherited-meter inflation when the car does
not reset its trip counter between drives (e.g. Cl 94.1 km stored vs ~50.5 km real on
2026-06-14). Migration `20260615120100` backfills closed trips from telemetry open/close samples.

**Short phantom trips** (parking D→R→P maneuvers inheriting a stale meter for a few seconds)
are still caught by `bydmate_discard_trip_if_junk` Rules A/B/C below.

## Junk filter (`bydmate_discard_trip_if_junk`)

Runs automatically at every trip close and deletes the trip + its track points if **any** rule
matches. Current deployed logic is migration **`20260613150000_fix_junk_trip_discard_v2.sql`**:

| Rule | Condition | Catches |
|---|---|---|
| **A** | `distance_km ≤ 0.1` AND `max_speed_kmh ≤ 3` | pure parking jitter |
| **B** | `duration < 60 s` AND `max_speed_kmh < 10` | slow short maneuvers |
| **C** | `distance_km > 0.3` AND implied speed `distance·3600/duration > max(max_speed·1.5, 80)` | inherited trip-meter phantoms — a genuine trip's average can never exceed its max instantaneous speed |

Rule C is the decisive one for inherited-distance phantoms: it caught a `4.5 km / 16 s`
(992 km/h implied, max 38) trip that Rule B missed.

> **Migration gotcha:** an earlier fix (`20260613130000`) was *edited after it had already been
> applied*, so its Rule B never reached the DB — `supabase db push` skips applied migrations.
> **Never edit an applied migration; always create a new file.** Verify the live definition with
> `select pg_get_functiondef('public.bydmate_discard_trip_if_junk(uuid)'::regprocedure);`.

### One-time historical cleanup

The filter only fires on *new* closes, so rows created before a filter change persist.
Preview candidates first. In `psql`, explicitly set `user_id`, `vehicle_id`, `from_time`,
and `to_time` for the intended owner, vehicle, and timestamp window before running this
query. The window includes `from_time` and excludes `to_time`; timestamps should include
a time zone. The preview returns the first matching rule using the server's null handling.

```sql
begin read only;

with cand as (
  select id, vehicle_id,
    extract(epoch from (ended_at - started_at)) as dur_s,
    distance_km, max_speed_kmh
  from public.bydmate_trips
  where user_id = :'user_id'::uuid
    and vehicle_id = :'vehicle_id'
    and ended_at is not null
    and started_at >= :'from_time'::timestamptz
    and started_at < :'to_time'::timestamptz
), classified as (
  select *, case
    when coalesce(distance_km, 0) <= 0.1 and coalesce(max_speed_kmh, 0) <= 3 then 'A'
    when coalesce(dur_s, 999) < 60 and coalesce(max_speed_kmh, 0) < 10 then 'B'
    when coalesce(dur_s, 0) > 0 and coalesce(distance_km, 0) > 0.3
      and distance_km * 3600.0 / nullif(dur_s, 0)
        > greatest(coalesce(max_speed_kmh, 0) * 1.5, 80) then 'C'
  end as discard_rule
  from cand
)
select id, vehicle_id, dur_s, distance_km, max_speed_kmh, discard_rule
from classified
where discard_rule is not null
order by vehicle_id, id;

rollback;
```

This preview never calls `bydmate_discard_trip_if_junk`: that function **deletes trips and
track points**. Cleanup is a separate, explicitly authorized write operation against reviewed
trip IDs, with owner and vehicle scope rechecked and a recovery copy prepared beforehand.
Do not turn the preview SELECT into a function call and continue treating it as a dry run.

## Client display filter (`src/lib/voltflowmate/trip-filter.ts`)

`isJunkTrip()` hides junk in the trip browser / analytics UI. ⚠️ **It is currently NOT in sync
with the server filter** — it only catches stationary-charging-like and `< 3`-sample trips
without movement evidence, so it would *not* hide an inherited-distance phantom if one were
served. The server discard is the authoritative gate; sync Rules B/C into this file if phantoms
ever surface in the UI.

## Trip splitting (history)

Before migration `20260612120000`, `CommandDaemon` heartbeats with reduced-payload `gear=1` (P)
at driving speed closed the live trip every ~60 s → 1-minute fragments. Fixed two ways:
a `speed ≤ 5` guard on the gear-P close, and (v0.3.9.5) the daemon staying silent on telemetry
while the app is alive. See `BYDMate-own/docs/REMOTE_COMMAND_DAEMON.md`.
