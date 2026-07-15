# VoltFlow

VoltFlow is a mobile-first PWA for EV charging, vehicle telemetry, trip history, and
maintenance records. It is built with Next.js, React, and Supabase.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Russian architecture reference](docs/ARCHITECTURE.ru.md)
- [Charging sessions](docs/CHARGING_SESSIONS.md)
- [Trips](docs/TRIPS.md)
- [Database schema](docs/DATABASE_SCHEMA.md)
- [Telemetry storage](supabase/TELEMETRY.md)
- [Android telemetry API](supabase/BYDMATE_APK_API.md)
- [Premium and retention](docs/PREMIUM_ADMIN.md)
- [Vehicle notifications](docs/VEHICLE_STATE_NOTIFICATIONS.md)
- [Installation guide (Russian)](INSTALL.md)

## Features

- Charging sessions with SOC, energy, tariff-aware estimates, and history.
- Live vehicle telemetry, trip history, route tracks, and analytics.
- Offline-capable PWA with responsive mobile navigation.
- Per-user access control through Supabase Auth and Row Level Security.
- Optional VoltFlow Mate integration for vehicle telemetry and remote commands.
- Knowledge-base content, maintenance records, and notifications.

## Development

Requirements: Node.js 22+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open the local development URL printed by Next.js. Use placeholder values in
`.env.local`; never commit credentials or environment-specific settings.

Useful commands:

```bash
npm run lint
npm run test
npm run build
```

## Security

Keep service credentials server-side. Client access uses the public project key and is
restricted by Row Level Security. Do not commit credentials, personal telemetry, or
environment-specific operational data.

## License

MIT License. See [LICENSE](LICENSE).
