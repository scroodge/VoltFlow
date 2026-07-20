# VoltFlow Product Status

## Available today

### Charging

- Live charging sessions with battery progress, elapsed time, energy, cost estimates, and
  charging history.
- Per-car charging settings and tariff-aware calculations.
- Automatic session start/stop when compatible vehicle telemetry is available.
- Live data takes priority over time-based estimates to avoid false completion states.

### Vehicle

- Optional VoltFlow Mate integration for live status, trips, route tracks, and analytics.
- While a vehicle view is visible, compatible Mate clients can provide an expiring fast live
  status path; normal background delivery remains batched to limit backend work.
- State-aware live telemetry focuses the parked view on relevant temperatures and can show a
  recent driving-based energy estimate.
- Trip details show traction and recovered energy, energy per kilometre, and net consumption
  after regeneration.
- Remote commands are available only where the connected vehicle integration supports them.
- Vehicle data is isolated per account through Row Level Security.

### History and maintenance

- Trip history, route maps, energy summaries, and export.
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

### Administration

- The users dashboard reports current registered users, daily connections, daily
  registrations and removals (Minsk time), and all-time recorded trips.
- An attention queue highlights stale telemetry, inactive or outdated Mate clients, and
  premium access nearing expiry.

## Public roadmap principles

Future product work is evaluated for user value, data ownership, privacy, reliability,
and accessibility before implementation. Public documentation describes released behavior.
