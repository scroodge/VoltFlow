# VoltFlow Product Status

## Available today

### Charging

- Live charging sessions with battery progress, elapsed time, energy, cost estimates, and
  charging history.
- Per-car charging settings and tariff-aware calculations.
- Automatic session start/stop when compatible vehicle telemetry is available.
- Manual entry and deletion of missed charging sessions from provider receipt totals,
  clearly marked as reconstructed rather than measured.
- Live data takes priority over time-based estimates to avoid false completion states.

### Vehicle

- Optional VoltFlow Mate integration for live status, trips, route tracks, and analytics.
- While a vehicle view is visible, compatible Mate clients can use an expiring fast-status path:
  after observing its grant, they send `live_only` snapshots on a configured roughly three-second
  cadence. Normal background delivery remains batched to limit backend work; this is not an
  end-to-end latency guarantee.
- State-aware live telemetry focuses the parked view on relevant temperatures and can show a
  recent driving-based energy estimate.
- Trip details show traction and recovered energy, energy per kilometre, and net consumption
  after regeneration.
- Remote commands are available only where the connected vehicle integration supports them.
- Vehicle data is isolated per account through Row Level Security.

### History and maintenance

- Trip history, route maps, energy summaries, and export.
- Day, period, and trip views use deliberately different consumption aggregations; the
  maintained formula reference documents which value each screen presents.
- Date-range analytics show per-trip and summary traction energy, plus a cell-balance trend
  based on completed full charges with partial charges shown as context.
- Maintenance records and reminders per vehicle.
- Content guides, parts, accessories, and service information.

### Platform

- Installable PWA for iOS and Android.
- English, Belarusian, and Russian application localization.
- Authenticated multi-user accounts, charge alerts, Android live-status notifications, Telegram
  live-status widgets, and data retention controls.
- Compatible VoltFlow Mate clients can submit cumulative hourly telemetry rollups alongside
  sample batches; sample-only clients remain supported.
- Final client-owned trip blocks are accepted idempotently and audited for 30 days without
  retaining additional GPS or raw payload data.

### Administration

- The users dashboard reports current registered users, daily connections, daily
  registrations and removals (Minsk time), and all-time recorded trips.
- An attention queue highlights stale telemetry, inactive or outdated Mate clients, and
  premium access nearing expiry.

## Status boundary

This page describes released behavior, not deployment health or proposed work. Current
proposals live in `BACKLOG.md`; shipped engineering history lives in `CHANGELOG.md`.
Environment-specific operations remain in local-only documentation.
