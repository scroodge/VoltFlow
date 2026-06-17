# Premium Admin Runbook

## Entitlement model

- `profiles.is_premium` remains supported as a manual premium override.
- `profiles.premium_until` enables time-limited premium access.
- Admin accounts (`admin_users`) are always premium with no expiry.
- Effective premium is: `is_admin OR is_premium OR premium_until > now()`.

## Admin UI

- Open `Settings` as admin and use `Premium пользователи` -> `Открыть Premium Admin`.
- `/admin/users` provides:
  - user list (email/id),
  - effective premium source (`admin`, `flag`, `term`, `none`),
  - last seen and latest Mate APK version,
  - 7d/30d activity counters (telemetry, trips, charging sessions),
  - premium controls (term presets, custom term, manual flag).

## Manual premium rules

- Non-admin users:
  - may be updated via `POST /api/admin/users/[id]/premium`.
  - can use flag and/or term.
- Admin users:
  - API rejects term changes with `admins are permanent premium`.
  - UI shows read-only permanent premium state.

## Retention policy

- Scheduled purge runs daily and applies tiered raw telemetry retention:
  - premium users: 365 days (`bydmate_telemetry_samples`, `bydmate_trip_track_points`),
  - non-premium users: 30 days for the same raw tables.
- Hourly rollups (`bydmate_telemetry_hourly`) keep the previous global policy (3 years).

