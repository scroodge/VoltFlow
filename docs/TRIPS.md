# Trips (`bydmate_trips`) — ingest lifecycle & junk filtering

How driving trips are created, extended, closed, and filtered. Companion to
[CHARGING_SESSIONS.md](CHARGING_SESSIONS.md). Server logic lives in the
`bydmate_ingest_telemetry` SQL function; the client-side display filter lives in
`src/lib/bydmate/trip-filter.ts`.

## Lifecycle (server, `bydmate_ingest_telemetry`)

Each telemetry sample drives a small state machine over the user's single open trip
(`ended_at is null`):

- **Open** — a sample with *drive evidence* (`v_is_drive_sample`: `speed_kmh > 5` **or**
  `gear ∈ {D, R, N}`) with no open trip creates a new `bydmate_trips` row.
- **Extend** — a drive sample within the 5-minute trip gap updates `last_device_time`,
  `sample_count`, `soc_end`, `max_speed_kmh`, `avg_speed_kmh`, and `distance_km`.
- **Close** — the trip closes when a sample shows charging, gear **P** (with the
  `speed ≤ 5` guard, migration `20260612120000`), or the 5-minute gap elapses. On close the
  row is run through `bydmate_discard_trip_if_junk`; survivors get `bydmate_finalize_trip_energy`.

### ⚠️ `distance_km` is the car's trip meter, not a per-trip delta

`distance_km` is set directly from `telemetry.current_trip_distance_km` — the car's own
cumulative trip-meter reading, copied as-is. **This is the root of phantom trips:** when a
real trip closes (gear→P) the car's meter does **not** reset immediately, so if the driver
shifts through R/D at 1–3 km/h during a parking maneuver, the ingest opens a *new* trip that
**inherits the stale meter value** (e.g. 2.4 km). Gear=P closes it seconds later → an artifact
like `10 s / 2.4 km / 3 km/h` or `16 s / 4.5 km / 38 km/h`. The deeper fix (baseline the meter
at open and store a delta) is not implemented — the junk filter below neutralizes the symptom.

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

The filter only fires on *new* closes, so rows created before a filter change persist. Backfill
them by re-running the function over the candidate window, e.g.:

```sql
-- dry run: list matches per vehicle for the current week
with cand as (
  select id, vehicle_id,
    extract(epoch from (ended_at-started_at)) as dur_s, distance_km, max_speed_kmh,
    case when extract(epoch from (ended_at-started_at))>0
         then distance_km*3600.0/extract(epoch from (ended_at-started_at)) end as implied
  from bydmate_trips where ended_at is not null and started_at >= date_trunc('week', now()))
select vehicle_id, public.bydmate_discard_trip_if_junk(id) as discarded
from cand
where (distance_km<=0.1 and max_speed_kmh<=3)
   or (dur_s<60 and max_speed_kmh<10)
   or (dur_s>0 and distance_km>0.3 and implied > greatest(max_speed_kmh*1.5,80));
```

(2026-06-13 cleanup removed 10 phantoms across `sed`/`way`/`cl`.)

## Client display filter (`src/lib/bydmate/trip-filter.ts`)

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
