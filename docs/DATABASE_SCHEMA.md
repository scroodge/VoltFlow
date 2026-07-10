# Database Schema

All tables live in the `public` schema on Supabase/Postgres.
RLS is enabled on every table; all user-scoped rows use `user_id = auth.uid()`.

---

## Entity-Relationship Overview

```
auth.users (Supabase Auth)
  │
  ├─── profiles            (1:1)
  │       │
  │       └─── push_subscriptions  (1:N)
  │
  ├─── cars                (1:N)
  │       │
  │       ├─── charging_sessions          (1:N)
  │       ├─── vehicle_service_records    (1:N)
  │       └─── vehicle_service_reminders  (1:N)
  │
  ├─── charging_tariff_locations  (1:N, per user)
  │
  ├─── bydmate_live_snapshots     (1:1 per user+vehicle_id)
  ├─── bydmate_telemetry_samples  (1:N per user+vehicle_id)
  ├─── bydmate_telemetry_hourly   (1:N per user+vehicle_id, hourly rollup)
  ├─── bydmate_telemetry_points   (1:N, DEPRECATED v1)
  ├─── bydmate_vehicle_state_notifications  (1:1 per user+vehicle_id)
  │
  ├─── bydmate_trips              (1:N per user+vehicle_id)
  │       └─── bydmate_trip_track_points  (1:N per trip)
  │
  ├─── vehicle_commands           (1:N per user+vehicle_id)
  ├─── user_service_categories    (1:N)
  │
  └─── (admin) admin_users

mate_app_releases               (global, no user_id)
knowledge_categories            (global CMS)
knowledge_articles              (global CMS)
faq_items                       (global CMS)
accessories                     (global CMS)
spare_parts                     (global CMS)
article_relations               (global CMS)
knowledge_items                 (global, vector search)
```

---

## Tables

### `profiles`
Mirror of `auth.users`. Created automatically on signup via trigger.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | = `auth.users.id` |
| `email` | text | |
| `preferred_currency` | text | `EUR/USD/BYN/RUB`, default `EUR` |
| `preferred_locale` | text | `en/be/ru`, default `en` |
| `default_price_per_kwh` | numeric | Legacy single tariff, default 0.12 |
| `home_price_per_kwh` | numeric | Tiered tariff — home charger |
| `commercial_ac_price_per_kwh` | numeric | Tiered tariff — AC public |
| `fast_dc_price_per_kwh` | numeric | Tiered tariff — DC fast |
| `bydmate_cloud_api_key` | text unique | API key for telemetry ingest |
| `vehicle_connected_at` | timestamptz | Last time vehicle came online |
| `telegram_id` | bigint | Telegram user ID (nullable) |
| `telegram_username` | text | Telegram username |
| `notify_channel` | text | `web_push`, `telegram`, or `both`, default `web_push` |
| `is_premium` | boolean | Manual premium override (`20260615140000`) |
| `premium_until` | timestamptz | Time-limited premium expiry (`20260617133000`) |
| `created_at` | timestamptz | |

Effective premium = `is_admin OR is_premium OR premium_until > now()`, computed by
`public.is_user_premium(user_id)`. See [PREMIUM_ADMIN.md](PREMIUM_ADMIN.md).

---

### `cars`
User's registered vehicles.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → auth.users | |
| `name` | text | Display name |
| `battery_capacity_kwh` | numeric | |
| `default_charger_power_kw` | numeric | Default 4.4 |
| `default_efficiency_percent` | numeric | Default 90, 0–100 |
| `model_generation` | text | `gen1_2024` or `gen2_2025` |
| `created_at` | timestamptz | |

`vehicle_alias` (stored in `bydmate_live_snapshots.vehicle_id`) links to `vehicle_id` in telemetry.

---

### `charging_sessions`
One row per charge event, live-updated during charging.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `car_id` | uuid FK → cars | |
| `start_percent` | numeric | SOC at session start, 0–100 |
| `current_percent` | numeric | Latest SOC, live-updated |
| `target_percent` | numeric | User's charge target, 0–100 |
| `battery_capacity_kwh` | numeric | Snapshot at session creation |
| `charger_power_kw` | numeric | |
| `efficiency_percent` | numeric | |
| `price_per_kwh` | numeric | |
| `charged_energy_kwh` | numeric | Accumulated energy |
| `estimated_cost` | numeric | |
| `status` | text | `idle / charging / completed / stopped` |
| `tariff_type` | text | `home / commercial_ac / fast_dc` |
| `provider_type` | text | `home / malanka / evika / forevo / zaryadka / batterfly / custom` |
| `tariff_manual` | boolean | User manually overrode tariff |
| `energy_overridden` | boolean | True when energy/cost were set from a non-SOC source |
| `started_at` | timestamptz | |
| `stopped_at` | timestamptz | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | Auto-updated via trigger |

Constraint: `start_percent < target_percent`.
Realtime replication enabled.

---

### `charging_tariff_locations`
Named GPS-tagged locations for automatic tariff detection.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `name` | text | e.g. "Home", "Work" |
| `lat` | double precision | |
| `lng` | double precision | |
| `radius_m` | numeric | Default 150, max 5000 |
| `tariff_type` | enum | `home / commercial_ac / fast_dc` |
| `provider_type` | enum | `home / malanka / evika / forevo / zaryadka / batterfly / custom` |
| `price_per_kwh_override` | numeric | Overrides profile tariff if set |
| `created_at` | timestamptz | |

---

### `push_subscriptions`
Web Push API subscriptions (one per device/browser).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `endpoint` | text unique | Push endpoint URL |
| `p256dh` | text | Public key |
| `auth` | text | Auth secret |
| `expiration_time` | bigint | Nullable |
| `created_at` / `updated_at` | timestamptz | |

---

## Telemetry

### `bydmate_live_snapshots`
Latest telemetry snapshot per vehicle — **one row per user+vehicle_id** (upserted on every ingest).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `vehicle_id` | text | Matches `cars.vehicle_alias` |
| `user_id` | uuid FK | |
| `source` | text | `BYDMate` |
| `schema_version` | integer | |
| `device_time` | timestamptz | Timestamp from vehicle |
| `received_at` | timestamptz | Server ingest time |
| `telemetry` | jsonb | Parsed fields (soc, speed, power, …) |
| `location` | jsonb | `{lat, lon, accuracy_m, …}` |
| `raw_payload` | jsonb | Original payload (size-reduced 2026-06) |
| `updated_at` | timestamptz | |

Unique constraint: `(user_id, vehicle_id)`.

---

### `bydmate_telemetry_samples`
~1 Hz lean telemetry samples (v2). Primary time-series table.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `vehicle_id` | text | |
| `user_id` | uuid FK | |
| `device_time` | timestamptz | |
| `received_at` | timestamptz | |
| `telemetry` | jsonb | `{soc, speed_kmh, power_kw, charge_power_kw, battery_temp_c, cabin_temp_c, outside_temp_c, soh_percent, odometer_km, gear, …}` |

Unique on `(user_id, vehicle_id, device_time)`.
Retention: free users **30 days**, premium + admin **unlimited** (kept indefinitely,
migration `20260626130000`). Managed by `purge_old_bydmate_telemetry_by_tier()` (see
[Retention & Housekeeping](#retention--housekeeping)).

---

### `bydmate_telemetry_hourly`
Hourly rollup aggregates derived from samples.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `vehicle_id` | text | |
| `hour_start` | timestamptz | Truncated to the hour |
| `sample_count` | integer | |
| `soc_min/max/last` | numeric | |
| `speed_max` | numeric | |
| `power_avg` | numeric | |
| `battery_temp_avg` | numeric | |
| `cabin_temp_avg` | numeric | |
| `outside_temp_avg` | numeric | |

Unique on `(user_id, vehicle_id, hour_start)`.

---

### `bydmate_telemetry_points`
**DEPRECATED** — v1 telemetry with full raw payloads. No longer written. Kept for historical reads.

---

### `bydmate_vehicle_state_notifications`
Tracks last-known vehicle state for park/unpark/charge push notifications.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid PK part | |
| `vehicle_id` | text PK part | |
| `last_device_time` | timestamptz | |
| `last_received_at` | timestamptz | |
| `last_soc` | numeric | |
| `last_odometer_km` | numeric | |
| `last_lat / last_lon` | double precision | |
| `last_is_parked` | boolean | |
| `last_connected_at` | timestamptz | |
| `last_disconnected_at` | timestamptz | |
| `last_park_notified_at` | timestamptz | |

---

## Trips

### `bydmate_trips`
One row per drive trip detected server-side.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `vehicle_id` | text | |
| `started_at` | timestamptz | |
| `ended_at` | timestamptz | Null if still open |
| `last_device_time` | timestamptz | Last sample seen |
| `sample_count` | integer | |
| `track_point_count` | integer | |
| `distance_km` | numeric | **Delta** from `trip_meter_baseline_km`, not raw odometer |
| `trip_meter_baseline_km` | numeric | Odometer reading at trip start |
| `soc_start / soc_end` | numeric | |
| `max_speed_kmh` | numeric | |
| `avg_speed_kmh` | numeric | |
| `avg_consumption_kwh_100km` | numeric | |
| `track_simplified_at` | timestamptz | Set after Ramer-Douglas-Peucker simplification |

---

### `bydmate_trip_track_points`
Raw GPS track points (simplified in-place by `bydmate_simplify_trip_track()`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `trip_id` | uuid FK → bydmate_trips | cascade delete |
| `user_id` | uuid FK | |
| `device_time` | timestamptz | |
| `lat / lon` | double precision | |
| `accuracy_m` | numeric | |
| `bearing_deg` | numeric | |
| `speed_kmh` | numeric | |
| `power_kw` | numeric | |
| `soc` | numeric | |

---

## Vehicle Commands

### `vehicle_commands`
Remote commands dispatched from the PWA to the vehicle via Mate.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `vehicle_id` | text | |
| `type` | text | Command type |
| `params` | jsonb | Command parameters |
| `status` | enum | `pending / sent / executed / failed` |
| `result` | jsonb | Response from vehicle |
| `created_at` | timestamptz | |
| `executed_at` | timestamptz | |

### `vehicle_command_schedules`
Recurring remote commands. Each row stores the user’s local `run_time`, IANA
`time_zone`, selected Sunday–Saturday `days_of_week`, and calculated `next_run_at`.
The Mate command-poll route atomically creates a normal `vehicle_commands` row only for
runs that are at most two minutes late, then advances `next_run_at`; missed runs are
skipped deliberately.

---

## Service Records

### `vehicle_service_records`
Maintenance and repair records for a car.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `car_id` | uuid FK → cars | |
| `title` | text | |
| `category` | text | |
| `service_type` | text | `maintenance / repair / inspection / …` |
| `performed_date` | date | |
| `odometer_km` | numeric | |
| `vendor_name / vendor_location` | text | |
| `parts_cost / labor_cost / total_cost` | numeric | |
| `currency` | text | Default `EUR` |
| `notes` | text | |
| `receipt_url / photo_urls` | text / jsonb | |
| `next_due_date` | date | |
| `next_due_km` | numeric | |
| `created_at` | timestamptz | |

---

### `vehicle_service_reminders`
Recurring or date/km-based service reminders.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `car_id` | uuid FK → cars | |
| `title` | text | |
| `category` | text | |
| `due_date` | date | |
| `due_km` | numeric | |
| `interval_days` | integer | For recurring reminders |
| `interval_km` | numeric | |
| `auto_renew` | boolean | |
| `last_completed_at` | timestamptz | |
| `created_at` | timestamptz | |

---

### `user_service_categories`
Custom service categories per user.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `name` | text | |
| `color` | text | Hex colour, default `#6B7280` |
| `created_at` | timestamptz | |

Unique on `(user_id, name)`.

---

## App Releases

### `mate_app_releases`
BYDMate Android APK release history (global, no user scope).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `version` | text unique | e.g. `"0.3.9.4"` |
| `version_code` | integer | e.g. `323` |
| `apk_url` | text | Direct download link |
| `release_notes` | text | Changelog |
| `published_at / created_at` | timestamptz | |

---

## Knowledge / CMS

Global content tables (no `user_id`). Managed by admins. Public read-only.

### `knowledge_categories`
| `id` uuid PK | `slug` unique | `title` | `description` | `sort_order` |

### `knowledge_articles`
Full articles with blocks.
| `id` uuid PK | `slug` unique | `title` | `summary` | `category_id` FK | `content` jsonb (blocks) | `tips` jsonb | `warnings` jsonb | `tags` text[] | `status` (draft/published) | `model_generations` text[] | `images` jsonb | `published_at` |

### `faq_items`
| `id` uuid PK | `question` | `answer` | `category_id` FK | `tags` text[] | `status` | `sort_order` |

### `accessories`
| `id` uuid PK | `title` | `category_id` FK | `use_case` | `why_useful` | `what_to_check` jsonb | `priority` | `risk_notes` jsonb | `external_links` jsonb | `image_url` | `model_generations` text[] | `status` | `sort_order` |

### `spare_parts`
| `id` uuid PK | `title` | `description` | `category_id` FK | `part_number` | `compatibility` | `external_links` jsonb | `images` jsonb | `model_generations` text[] | `status` | `sort_order` |

### `article_relations`
M2M self-join on `knowledge_articles`.
| `article_id` uuid | `related_article_id` uuid |

### `knowledge_items`
Flattened knowledge records with pgvector embeddings for semantic search.
| `id` uuid PK | `title` | `content` | `category` | `source_type` | `source_url` | `telegram_message_id` | `source_id` uuid | `source_slug` | `model_generations` text[] | `tags` text[] | `embedding` vector(1536) | `is_published` boolean |

---

## Admin

### `admin_users`
Simple allowlist for admin access.
| `user_id` uuid PK → auth.users | `email` | `created_at` |

---

## Key Functions / RPCs

**Postgres functions / RPCs** (defined in `supabase/migrations/`):

| Function | Purpose |
|---|---|
| `bydmate_ingest_telemetry(…)` | Core ingest: writes sample → live snapshot → trip logic → hourly rollup |
| `bydmate_ingest_telemetry_batch(…)` | Batch variant accepting `jsonb[]` |
| `bydmate_discard_trip_if_junk(…)` | Server-side junk trip discard (Rule A/B/C) — see [TRIPS.md](TRIPS.md) |
| `bydmate_finalize_trip_energy(…)` | Compute trip regen/traction energy at close |
| `bydmate_simplify_trip_track(p_trip_id)` | Ramer-Douglas-Peucker GPS simplification |
| `simplify_aged_bydmate_trip_tracks()` | Batch simplification for trips older than 48 h |
| `purge_old_bydmate_telemetry_by_tier()` | **Current** retention purge (free 30d raw, premium+admin unlimited, hourly 3y); scheduled by pg_cron |
| `is_user_premium(user_id)` | Effective premium check (admin OR flag OR term) |
| `search_knowledge_items(…)` / `match_knowledge_items(…)` | pgvector cosine similarity search |

> Superseded purge functions kept in history only: `purge_old_bydmate_telemetry()`
> (legacy global 90d/3y) and `bydmate_prune_telemetry_samples()`. The pg_cron job
> `purge-bydmate-telemetry` calls `purge_old_bydmate_telemetry_by_tier()`.

**Application logic (TypeScript, not Postgres RPCs)** — run from the ingest route, not
the database:

| Function | Purpose | File |
|---|---|---|
| `processBydmateAutoChargingSessions()` | Auto start/stop charging sessions on ingest | `src/lib/bydmate/charging-auto-session.ts` |
| `reconcileChargingSessionsForUser()` | Repair broken session rows | `src/lib/charging-session-reconcile.ts` |

---

## Enums

| Enum | Values |
|---|---|
| `vehicle_command_status` | `pending, sent, executed, failed` |
| `charging_tariff_type` | `home, commercial_ac, fast_dc` |
| `charging_provider_type` | `home, malanka, evika, forevo, zaryadka, batterfly, custom` |

---

## Retention & Housekeeping

Scheduled daily by the pg_cron job `purge-bydmate-telemetry` →
`purge_old_bydmate_telemetry_by_tier()` (registered in `20260624130000`; tiers set by
`20260617133000` → `20260617135500` → `20260626130000`).

| Data | Free | Premium + Admin |
|---|---|---|
| `bydmate_telemetry_samples` (raw) | 30 days | **Unlimited** (kept forever) |
| `bydmate_trip_track_points` | 30 days | **Unlimited** |
| `bydmate_telemetry_hourly` | 3 years | 3 years |

- `is_user_premium()` already returns true for admins, so premium + admin are fully exempt.
- `bydmate_trip_track_points` are also simplified (RDP) after 48 h (non-simplified points
  deleted), independent of the retention purge.
- `bydmate_telemetry_points` (v1): orphaned, not pruned automatically.

---

## Storage (buckets & RLS)

Supabase Storage buckets live in the `storage` schema. `storage.objects` has
**RLS enabled**, so writes require explicit policies — `public = true` only
grants public **read**, never write.

| Bucket | Public read | Purpose |
|---|---|---|
| `knowledge-accessories` | ✅ | Accessory images |
| `knowledge-articles` | ✅ | Article images |
| `knowledge-spare-parts` | ✅ | Spare-part images |
| `service-attachments` | ✅ | Service-record receipts/photos |
| `cluster-backgrounds` | ❌ | Cluster projection backgrounds |

**Write policies (migration `20260630120000`):** insert/update/delete on all
five buckets are restricted to admins — the policy checks
`exists (select 1 from public.admin_users where user_id = auth.uid())`.
The app uploads via the SSR client (anon key + user JWT → role `authenticated`),
so without these policies every upload is denied and the admin create/edit
actions 500 at the upload step (root cause found 2026-06-30).

> **Self-hosted note:** storage buckets and their policies are **not** part of
> the normal Studio setup carried over on the hosting migration — they were
> missing on prod, which is why uploads silently broke. Keep storage policies in
> a SQL migration (`20260630120000`) so the repo remains the source of truth.

---

## Assessment & open items

A prior version of this file embedded a full DB assessment + recommendation backlog.
That content now lives in [../BACKLOG.md](../BACKLOG.md) (FK on `vehicle_id`, telemetry
partitioning, tariff-column cleanup, `numeric`-vs-`real` debt) so there is one place for
proposed work.

What is well done today: RLS on every user table (`auth.uid()` scoping), pgvector + HNSW
semantic search, pg_cron tiered retention, the JSONB-plus-typed-`diplus_*` hybrid (raw
`diplus` blob dropped, DB 509 → 258 MB), point-in-time snapshotting of capacity/power/
efficiency onto `charging_sessions`, and idempotent `IF NOT EXISTS` migrations for the
self-hosted prod. The two items that separate this from "scales cleanly to large telemetry
volume" are **FK integrity on `vehicle_id`** and **time-partitioning the samples table** —
both in the backlog.
