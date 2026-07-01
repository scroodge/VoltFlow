# VoltFlow — Capabilities & Roadmap

A single, plain-language answer to two questions: **what the system does today**, and
**what we can improve next**. For how it works internally see
[ARCHITECTURE.md](ARCHITECTURE.md); for the running work logs see
[../CHANGELOG.md](../CHANGELOG.md) (shipped) and [../BACKLOG.md](../BACKLOG.md) (proposed).

_Last reviewed: 2026-07-01._

---

## Part 1 — What VoltFlow can do today

### ⚡ Charging
- Live charging cockpit: battery %, elapsed/remaining time, delivered kWh, AC power, and
  tariff-aware cost — recomputed from wall-clock math so refreshes/reconnects stay correct.
- Accurate energy & cost from **SOC × battery capacity** (efficiency ≈ 100 %), per-car.
- **Auto sessions from the car:** the ingest pipeline auto-starts/stops a charging session
  when VoltFlow Mate reports charging — no need to open the app to open/close a session.
- **Charge integrity guards:** never marks "completed" from math while live data exists;
  drive-away closes a session as "stopped"; manual stop prefers live → telemetry → math.
- Estimated finish time and projected SOC-at-07:00 on the active screen.
- Tariff/provider presets (Malanka, Evika, forEVo, Zaryadka, BatteryFly, home/custom) with
  GPS-based home-charger auto-tariff.
- Full charging history with per-session SOC/energy charts.

### 🚗 Live telemetry & vehicle status
- ~1 Hz live data from **VoltFlow Mate** (Android gateway on the car's DiLink unit), pushed
  to the PWA over Supabase Realtime (no polling).
- Live vehicle view: SOC, speed, power, temperatures, cell voltages, doors/windows/tires,
  HVAC, gear, range estimate, and rich Di+ diagnostics.
- Remote commands (lock/unlock, set SOC limit, schedule charge, windows, sunroof, etc.)
  dispatched PWA → car via the Mate command poller.

### 🗺️ Trips & analytics
- Server-side trip detection with junk-trip filtering and per-trip distance deltas.
- Per-trip charts (SOC, speed & power, recovered-energy bars, temperatures, cell delta) and
  an OpenStreetMap route map with metric layers and hover tooltips.
- **History → Analytics:** day/week/month/quarter/year KPIs, phantom-drain, consumption vs
  outside temp, SoH trend, monthly stats, cost/km, lifetime map, and route insights
  (repeat-route clustering, rename, parking spots). CSV/JSON export.

### 🔔 Notifications
- Web push (VAPID) for charge-threshold/completion events.
- Telegram bot notifications for vehicle state (connected / parked / disconnected).

### 📚 Knowledge base
- Telegram-style CMS: guides, FAQ, accessories, spare parts, generation filters.
- Semantic search over content (OpenAI embeddings + pgvector), with static fallback.
- Admin CMS for all content types; Telegram Mini App entry.

### 🔧 Service logbook
- Maintenance/repair records and reminders per car, with receipts/photos and cost tracking.

### 👤 Accounts, premium & platform
- Supabase Auth + Row Level Security; every user only sees their own data.
- Premium entitlements (admin / flag / time-limited term) with a `/admin/users` console
  (activity counters, APK version, premium controls) and tiered telemetry retention.
- Installable PWA (offline shell, iOS/Android install), i18n (English / Belarusian /
  Russian), multi-currency (EUR/USD/BYN/RUB).
- Self-hosted Supabase backend with monitoring and alerting.

---

## Part 2 — What we can improve

Ordered by priority. Detail and trade-offs live in [../BACKLOG.md](../BACKLOG.md).

### 🟠 Premium onboarding — still manual (pending)
**Today:** premium is granted **manually**. The user taps an upgrade CTA that opens a
prefilled email; an admin then flips the flag/term in `/admin/users`. There is **no
self-serve signup or payment** — it doesn't scale and adds friction/delay for the user.

**Improvement options (not built):**
- Self-serve upgrade with an actual payment provider (card / local rails), auto-setting
  `premium_until` on success and on renewal/expiry.
- In-app upgrade screen (plans, price, term) instead of the mailto flow.
- Confirm the premium **data-retention window** shown to users matches the published
  privacy policy before advertising a specific number.

_This is the top product gap — decide the billing approach, then we can plan it._

### 🔴 Correctness — revert BMS-for-cost code (bug)
Some code paths use the BMS cell-energy counter (`kwh_charged`) for cost/power; it reads
~47 % low. Revert to SOC × capacity for cost and keep the counter for diagnostics only.
(Root cause validated; see [CHARGING_SESSIONS.md](CHARGING_SESSIONS.md).)

### 🟡 Scale & database
- **Partition `bydmate_telemetry_samples` by time** so retention becomes `DROP PARTITION`
  instead of bulk deletes (BRIN index already in place as an interim win).
- **Promote `vehicle_id` to a real foreign key** — it's a soft text key today, so a typo or
  alias change can silently orphan telemetry/trips.

### 🔵 Smaller debt & polish
- Retire the legacy `profiles.default_price_per_kwh` column (superseded by tiered tariffs).
- Use `real`/`double precision` for telemetry columns that don't need exact decimals.
- Sync the client `isJunkTrip` filter with the authoritative server discard rules.

### 💡 Product opportunities (not yet scoped)
- More charging providers / countries and smarter tariff auto-detection.
- Deeper battery-health insights using the cell-energy vs grid-energy signal we already collect.
- Broader remote-command surface and scheduling.

---

**Summary:** the charging cockpit, live telemetry, trips, analytics, notifications, and
knowledge base are all working in production. The biggest lever is **turning premium
onboarding from a manual email process into a self-serve, paid flow**; the most urgent
fix is the **BMS-for-cost revert**; and the main scaling work is **telemetry partitioning
+ a real vehicle foreign key**.
