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
  - top counters: `Connections today` and `Registered users`.

## Free-user information flow

- Non-premium users see a retention notice in `Settings` with:
  - free retention window (`30 days`),
  - next cleanup window datetime,
  - one-click premium upgrade CTA.
- Legal privacy documents explicitly describe retention windows:
  - free: 30 days raw telemetry/tracks,
  - premium: 365 days raw telemetry/tracks,
  - deletion after retention is irreversible.

## Upgrade request procedure (email-only)

- Current premium onboarding is manual via email to `washjurine@gmail.com`.
- App CTA opens a prefilled `mailto:` template containing:
  - account email,
  - user id,
  - preferred premium term,
  - app language.
- Admin then updates premium in `/admin/users` via manual flag and/or term.

## Manual premium rules

- Non-admin users:
  - may be updated via `POST /api/admin/users/[id]/premium`.
  - can use flag and/or term.
- Admin users:
  - API rejects term changes with `admins are permanent premium`.
  - UI shows read-only permanent premium state.

## Retention policy

- Scheduled purge runs daily (`purge_old_bydmate_telemetry_by_tier()`, pg_cron job
  `purge-bydmate-telemetry`) and applies tiered raw telemetry retention:
  - **non-premium users: 30 days** raw (`bydmate_telemetry_samples`, `bydmate_trip_track_points`),
  - **premium users + admins:** retained per the current purge tier (see
    `purge_old_bydmate_telemetry_by_tier()` — verify against the in-app privacy text
    before quoting a specific window to users).
- Hourly rollups (`bydmate_telemetry_hourly`) keep the global policy (3 years).

