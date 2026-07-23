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
  ├─── user_providers             (1:N, per user)
  │
  ├─── bydmate_live_snapshots     (1:1 per user+vehicle_id)
  ├─── bydmate_telemetry_samples  (1:N per user+vehicle_id)
  ├─── bydmate_telemetry_hourly   (1:N per user+vehicle_id, hourly rollup)
  ├─── bydmate_live_status_state  (1:1 per user+vehicle_id, app notification state)
  ├─── bydmate_telemetry_points   (1:N, DEPRECATED v1)
  ├─── bydmate_battery_snapshots  (1:N per user+vehicle_id)
  ├─── bydmate_idle_drains        (1:N per user+vehicle_id)
  ├─── telegram_live_messages     (1:1 per user+vehicle_id)
  │
  ├─── bydmate_trips              (1:N per user+vehicle_id)
  │       └─── bydmate_trip_track_points  (1:N per trip)
  │
  ├─── vehicle_commands           (1:N per user+vehicle_id)
  ├─── vehicle_command_schedules  (1:N per user+vehicle_id)
  ├─── user_service_categories    (1:N)
  │
  └─── (admin) admin_users

mate_app_releases               (global, no user_id)
knowledge_categories            (global CMS)
knowledge_articles              (global CMS)
knowledge_article_views         (global, view counters)
faq_items                       (global CMS)
accessories                     (global CMS)
spare_parts                     (global CMS)
article_relations               (global CMS)
knowledge_items                 (global, vector search)
service_providers               (global, public catalog)

telegram_group_events           (service-role only, Telegram inbox)
community_listings              (moderated drafts from telegram_group_events)
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
| `vehicle_connected_at` | timestamptz | First accepted telemetry time; used to mark Mate onboarding complete |
| `telegram_id` | bigint | Telegram user ID (nullable) |
| `telegram_username` | text | Telegram username |
| `notify_channel` | text | `web_push`, `telegram`, or `both`, default `web_push` |
| `live_status_mode` | text | User-owned Android live-status preference: `off`, `charging`, or `charging_parked`; default `charging` |
| `live_fast_until` | timestamptz | App-owned, expiring visible-view status grant; safe to lose |
| `live_fast_vehicle_id` | text | Vehicle alias the expiring fast-status grant applies to |
| `is_premium` | boolean | Manual premium override (`20260615140000`) |
| `premium_until` | timestamptz | Time-limited premium expiry (`20260617133000`) |
| `last_active_at` | timestamptz | Last telemetry or login (`20260706120000`) |
| `inactivity_warning_sent_at` | timestamptz | Set when the 30-day inactivity warning email is sent; account is eligible for deletion once `last_active_at` is >60 days old **and** this is set |
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
| `default_efficiency_percent` | numeric | AC (home/commercial) grid-to-battery efficiency, default 90, 0–100 |
| `fast_dc_efficiency_percent` | numeric | Fast-DC grid-to-battery efficiency, measured separately (`20260713100000`) — DC dispensers meter upstream of cooling/heat losses AC doesn't have |
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
| `provider_type` | text | `home / malanka / evika / forevo / zaryadka / batterfly / custom / user_provider` — `user_provider` means look up `user_provider_id` |
| `user_provider_id` | uuid FK → user_providers | Set only when `provider_type = 'user_provider'` (`20260706180000`) |
| `tariff_manual` | boolean | User manually overrode tariff |
| `tariff_selected_at` | timestamptz | When the user last manually picked a tariff/provider on this session; delays auto-saving a GPS tariff location until the pick "sticks" (`20260706020000`) |
| `energy_overridden` | boolean | True when energy/cost were set from a non-SOC source |
| `energy_corrected_at` | timestamptz | When a provider-billed energy/cost correction was applied |
| `end_max_cell_delta_v` | numeric | Maximum cell-voltage delta measured near the session's peak charging SOC |
| `end_delta_soc` | numeric | SOC at which `end_max_cell_delta_v` was measured |
| `started_at` | timestamptz | |
| `stopped_at` | timestamptz | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | Auto-updated via trigger |

Constraint: `start_percent < target_percent`.
Realtime replication enabled.

### `charging_efficiency_observations`
App-owned measurements created when a user corrects a completed session with provider-billed
energy and cost. They preserve the evidence required to suggest, but never automatically apply,
per-car charging efficiency values after raw telemetry retention expires.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` / `car_id` / `session_id` | uuid FK | Owning account, car, and corrected session |
| `tariff_type` | text | `home`, `commercial_ac`, or `fast_dc` |
| `measured_efficiency_percent` | numeric | Battery-side SOC energy divided by provider-billed grid energy |
| `soc_delta_percent` / `battery_capacity_kwh` | numeric | Inputs used for the measurement |
| `billed_energy_kwh` / `billed_total_cost` | numeric | User-entered provider-billed values |
| `avg_battery_temp_c` / `avg_outside_temp_c` / `avg_charge_power_kw` | numeric | Telemetry context snapshot; nullable |
| `telemetry_sample_count` | integer | Samples contributing to that context |
| `computed_at` | timestamptz | Correction time |

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
| `provider_type` | enum | `home / malanka / evika / forevo / zaryadka / batterfly / custom / user_provider` |
| `user_provider_id` | uuid FK → user_providers | Set only when `provider_type = 'user_provider'` |
| `price_per_kwh_override` | numeric | Overrides profile tariff if set |
| `created_at` | timestamptz | |

---

### `user_providers`
User-owned charging providers — labels and per-tariff prices the user can edit or
delete. Migration `20260706180000` created the table; `20260706200000` folded the
previously hardcoded built-in providers (Home, Malanka, Evika!, forEVo, Zaryadka,
BatteryFly) into it as ordinary seeded rows every user can reprice or delete, except
Home (`is_default = true`, permanent). The old app-owned `provider_tariffs` override
table was dropped in the same migration — this is the sole editable provider store now.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `label` | text | Display name, e.g. "Home", "Malanka" |
| `home_price_per_kwh` | numeric | |
| `commercial_ac_price_per_kwh` | numeric | |
| `fast_dc_price_per_kwh` | numeric | |
| `is_default` | boolean | True only for the permanent seeded "Home" row |
| `created_at` / `updated_at` | timestamptz | |

Unique on `(user_id, label)`. Seed prices must match `PROVIDER_TARIFF_PRESETS` in
`src/lib/charging-tariffs.ts`.

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
| `raw_payload` | jsonb | Original validated payload (size-reduced 2026-06); GPS is removed with `location` after 24 h of inactivity |
| `updated_at` | timestamptz | |

Unique constraint: `(user_id, vehicle_id)`.

### `bydmate_live_status_state`
App-owned per-vehicle state used by the server to throttle and deduplicate Android live-status
web pushes. It is distinct from `profiles.live_status_mode`, which is the user's preference.

| Column | Type | Notes |
|---|---|---|
| `user_id` / `vehicle_id` | uuid / text PK | Account and vehicle stream |
| `last_state` | text | Most recently processed `charging`, `parked`, or `driving` phase |
| `last_sent_at` | timestamptz | Last live-status push action |
| `last_soc` | numeric | SOC associated with the last action |
| `charge_started_at` / `charge_start_soc` | timestamptz / numeric | State for the charging delta and ETA |
| `updated_at` | timestamptz | Trigger-maintained |

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
Retention: free users **30 days**; Premium/Admin data is retained indefinitely while the account
is active (migration `20260626130000`). Managed by `purge_old_bydmate_telemetry_by_tier()` (see
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

### `bydmate_battery_snapshots`
BMS health snapshots recorded at charge session ends where SOC delta ≥5%. Tracks
battery degradation over time (`20260708140000`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `vehicle_id` | text | |
| `recorded_at` | timestamptz | |
| `odometer_km` | numeric | |
| `soc_start` / `soc_end` | numeric | |
| `kwh_charged` | numeric | |
| `calculated_capacity_kwh` | numeric | |
| `soh_percent` | numeric | |
| `cell_delta_v` | numeric | |
| `bat_temp_avg_c` | numeric | |
| `charge_id` | uuid | |
| `created_at` | timestamptz | |

### `bydmate_idle_drains`
Zero-km trips from BYD `energydata` indicating parked energy consumption
(`20260708140000`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `vehicle_id` | text | |
| `start_ts` / `end_ts` | timestamptz | |
| `kwh_consumed` | numeric | |
| `created_at` | timestamptz | |

### `telegram_live_messages`
Tracks the single editable Telegram live-status message per vehicle. Replaced the
discrete connect/park/disconnect notifications (`bydmate_vehicle_state_notifications`,
dropped `20260706000000`) — see
[VEHICLE_STATE_NOTIFICATIONS.md](VEHICLE_STATE_NOTIFICATIONS.md).

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid PK part | |
| `vehicle_id` | text PK part | |
| `chat_id` | bigint | |
| `message_id` | integer | |
| `status` | text | `active` (only value currently written) |
| `updated_at` | timestamptz | |

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
| `source` | text | `telemetry` (default, from `bydmate_telemetry_samples`) or `byd_energydata` (imported from the car's own trip log, no ADB required, no SOC/track data) — `20260706190000` |
| `fuel_kwh` | numeric | PHEV (DM-i) fuel consumption from BYD `energydata`. **Unit is ambiguous** — column is named `_kwh` but the migration comment says "liters equivalent"; NULL for pure EVs, >0 for PHEV (`20260708120000`) |

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
| `status` | enum | `pending / sent / done / failed / rejected` |
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

### `knowledge_article_views`
Article view counters, kept in their own table rather than a column on
`knowledge_articles` (`20260713190000`) — that table's `BEFORE UPDATE` trigger stamps
`updated_at = now()`, so a `view_count` column there would turn "recently updated" into
"recently viewed". `anon`/`authenticated` have select-only grants; the only write path
is the `SECURITY DEFINER` RPC `increment_knowledge_article_view(slug)`.

| `article_id` uuid PK → knowledge_articles | `view_count` bigint | `last_viewed_at` timestamptz |

### `knowledge_items`
Flattened published knowledge records for content discovery.
| `id` uuid PK | `title` | `content` | `category` | `source_type` | `source_url` | `telegram_message_id` | `source_id` uuid | `source_slug` | `model_generations` text[] | `tags` text[] | `is_published` boolean |

### `service_providers`
App-owned public directory of repair shops, mobile services, detailers, and purchasable
service offers. Published rows are readable anonymously; admin users manage the catalog.
Booking and payment remain external links.

| Column | Purpose |
|---|---|
| `name` | Provider or service name |
| `provider_type` | Service center, mobile service, detailer, parts and service, or other |
| `city`, `address`, `service_area` | Location, street address, and coverage |
| `services` jsonb | Services offered, one string per item |
| `price_from`, `currency` | Optional starting price |
| `external_links` jsonb | Contact, booking, website, or payment links |
| `model_generations` text[] | Compatible Yuan Up generations |
| `verified_at` | Optional date of last catalog verification |
| `status` | `draft`, `published`, or `archived` |

---

## Community marketplace (Telegram bot)

Raw Telegram group messages become moderated marketplace drafts, never public content
directly. The live pipeline runs outside the Next.js app, in the Python edge server
`scripts/telegram-miniapp-server.py`: `handle_webhook()` receives the real registered
Telegram webhook, `process_telegram_group_event()` writes the raw event, classifies it
with `verify_telegram_text()`, and `upsert_community_listing()` inserts the
`community_listings` draft — all inline on the same request, with
`process_pending_group_events()` as a batch retry path. A TypeScript equivalent
(`verifyTelegramContext` in `src/lib/llm-context-verifier.ts`) exists but is not wired
to any ingest path; `src/app/api/telegram/webhook/route.ts` only sends the PWA deep-link
reply and never touches `telegram_group_events` or `community_listings`. The Next.js app
reads `community_listings` only through the admin moderation UI
(`src/lib/supabase/community-listings.ts`, `src/app/admin/knowledge/marketplace/`).

### `telegram_group_events`
Short-lived, service-role-only inbox for Telegram group updates (`20260714150000`,
verification columns added `20260714153000`). `anon`/`authenticated` have no grants at
all — service role only. Rows expire after 7 days (`expires_at`).

| Column | Purpose |
|---|---|
| `update_id`, `chat_id`, `message_id` | Telegram identifiers |
| `event_type` | `new` or `edited` |
| `text`, `raw_update` jsonb | Message content |
| `status` | `pending / processing / processed / failed / ignored` |
| `intent` | Qwen classification: `sell / wanted / service / question / irrelevant / ambiguous` |
| `confidence` | 0–1 |
| `title`, `item_type`, `city`, `generation`, `price`, `currency`, `contact` | Extracted listing fields |
| `actionable` | Whether this event should become a `community_listings` draft |
| `needs_review` | Default `true` — admin must confirm before publish |
| `expires_at` | Default `received_at + 7 days` |

### `community_listings`
Moderated marketplace drafts derived from `telegram_group_events` (`20260714160000`,
admin write grants `20260715100000`). Drafts are never public until an admin
explicitly publishes them (`status = 'published'`). Managed via
`src/lib/supabase/community-listings.ts` and `src/app/admin/knowledge/marketplace/`.

| Column | Purpose |
|---|---|
| `owner_user_id` | Nullable — set if the poster is a linked VoltFlow user |
| `telegram_user_id` | Poster's Telegram ID |
| `listing_type` | `sell / wanted / service` |
| `title`, `description`, `item_type`, `city`, `generation`, `price`, `currency`, `contact_link` | Listing content |
| `source_chat_id`, `source_message_id` | Origin message; unique together |
| `status` | `draft / published / sold / expired / removed` |
| `expires_at` | Default `created_at + 30 days` |

Public read policy allows anonymous `select` only for `status = 'published' AND
expires_at > now()`; all other access requires `is_admin()`.

---

## Admin

### `admin_users`
Simple allowlist for admin access.
| `user_id` uuid PK → auth.users | `email` | `created_at` |

### `admin_user_lifecycle_daily`
App-owned aggregate counters used by the admin users dashboard. It stores no deleted-user
identifiers and is inaccessible to browser roles.
| `metric_date` date PK | `registered_count` integer | `removed_count` integer |

The `admin_users_dashboard_stats()` service-role-only function returns exact connected-
today, registration/removal-today, current-user, and all-time recorded-trip counts. The
`profiles` insert/delete triggers maintain the daily lifecycle counters in Europe/Minsk
time.

The service-role-only `admin_users_attention_queue()` function derives an admin-only
follow-up queue from profile, snapshot, release, entitlement, and admin-role facts. It
persists no additional user data.

---

## Key Functions / RPCs

**Postgres functions / RPCs** (defined in `supabase/migrations/`):

| Function | Purpose |
|---|---|
| `bydmate_ingest_telemetry(…)` | Core ingest: writes sample → live snapshot → trip logic → hourly rollup |
| `bydmate_ingest_telemetry_batch(…)` | Batch variant accepting `jsonb[]` |
| `bydmate_discard_trip_if_junk(…)` | Server-side junk trip discard (Rule A/B/C) — see [TRIPS.md](TRIPS.md) |
| `bydmate_finalize_trip_energy(…)` | Compute trip regen/traction energy at close |
| `bydmate_ingest_trip_summaries(…)` | Batch upsert for BYD-side `energydata` trip-log imports (no ADB, no telemetry samples) — `source = 'byd_energydata'` |
| `increment_knowledge_article_view(p_slug)` | `SECURITY DEFINER` view-count increment for `knowledge_article_views` |
| `bydmate_simplify_trip_track(p_trip_id)` | Ramer-Douglas-Peucker GPS simplification |
| `simplify_aged_bydmate_trip_tracks()` | Batch simplification for trips older than 48 h |
| `purge_old_bydmate_telemetry_by_tier()` | **Current** retention purge (free: 30d raw / 3y hourly; Premium+Admin: retained while the account is active; stale live GPS cleared after 24h); scheduled by pg_cron |
| `is_user_premium(user_id)` | Effective premium check (admin OR flag OR term) |

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
| `charging_provider_type` | `home, malanka, evika, forevo, zaryadka, batterfly, custom, user_provider` |

---

## Retention & Housekeeping

Scheduled daily by the pg_cron job `purge-bydmate-telemetry` →
`purge_old_bydmate_telemetry_by_tier()` (registered in `20260624130000`; tiers set by
`20260617133000` → `20260617135500` → `20260626130000`).

| Data | Free | Premium + Admin |
|---|---|---|
| `bydmate_telemetry_samples` (raw) | 30 days | Retained while the account is active |
| `bydmate_trip_track_points` | 30 days | Retained while the account is active |
| `bydmate_telemetry_hourly` | 3 years | Retained while the account is active |

- `is_user_premium()` already returns true for admins, so premium + admin are fully exempt.
- Free-account `bydmate_trip_track_points` are simplified (RDP) after 48 h before their
  30-day expiry. Premium/Admin raw route points are retained unchanged while the account is active.
- A stale `bydmate_live_snapshots` row keeps non-location status but has exact GPS removed
  from both `location` and `raw_payload` after 24 hours without a new received sample.
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
