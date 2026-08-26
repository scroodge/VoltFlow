# Postman collection

`EvAcChargeTimer.postman_collection.json` covers every HTTP route under
`src/app/api/**` (41 route files, 50 requests once all exported methods per
file are counted) plus the legacy Supabase Edge Function telemetry
passthrough. Generated from route source inspection on 2026-08-16 — see
`BACKLOG.md` for the research notes this was built from.

## Import

Postman → Import → select `EvAcChargeTimer.postman_collection.json`.

## Collection variables

Set these under the collection's Variables tab (or a Postman Environment):

| Variable | Used by | Notes |
|---|---|---|
| `base_url` | all Next.js routes | Defaults to `http://localhost:3000` |
| `supabase_cookie` | session-cookie routes (`admin/*`, `vehicle/*`, `cluster-backgrounds`, `bydmate/link-code`, `telegram/link`) | Paste the full Supabase auth cookie value from browser devtools |
| `bydmate_api_key` | device/car routes (`bydmate/telemetry`, `bydmate/trip-summaries`, `bydmate/commands*`, `bydmate/dashboard/session`, `bydmate/cluster-backgrounds*`) | The car/daemon's provisioned API key, not a user session |
| `vehicle_id` | most `vehicle/*` and `bydmate/*` device routes | |
| `cron_secret` | `cron/aux-battery-health`, `cron/inactivity-check` | Must match the server's `CRON_SECRET` env var |
| `telegram_webhook_secret` | `telegram/webhook` | Must match `TELEGRAM_WEBHOOK_SECRET` |

Requests also carry a **disabled** `x-voltflow-dev-auth-bypass: 1` header
wherever session auth is used — enable it only against a non-production
server to impersonate the fixed dev user/vehicle instead of supplying a real
session cookie.

## Auth families

1. **Supabase session cookie** — most `vehicle/*`, `admin/*`, top-level
   `cluster-backgrounds`.
2. **Device API key** (`x-api-key` [+ `x-vehicle-id`]) — the BYD Mate
   car/daemon ingest path under `bydmate/*`.
3. **Shared-secret header** — `cron/aux-battery-health`, `cron/inactivity-check`,
   `telegram/webhook`.
4. **Public / self-verifying** — `push/vapid-public-key`,
   `bydmate/latest-release`, `knowledge/search`, `bydmate/link-code/redeem`,
   `telegram/auth` (verifies Telegram `initData` HMAC itself).

> **Warning:** manual testing or scheduling for battery health must target only
> `cron/aux-battery-health`. The separate inactivity check can delete accounts
> after 60 days and must not be activated without its own audit and approval.

## Notes

- `dev-wb (dev-only)` folder covers routes that hard-404 outside
  `NODE_ENV !== production` (a local marketplace-search proxy).
- Request bodies are best-effort placeholders derived from each route's
  `request.json()` reads, not full schema validation — check the route
  source under `src/app/api/**/route.ts` for exact shapes before relying on
  them for anything beyond a smoke test.
- The `edge-function (legacy)` folder targets the Deno passthrough at
  `supabase/functions/bydmate-telemetry`; set a `supabase_functions_url`
  variable (e.g. `https://<project-ref>.supabase.co/functions/v1`) if you
  need to exercise it — it has no auth of its own and just forwards to the
  canonical `/api/bydmate/telemetry` route.
- Keep this collection in sync manually when routes are added/removed;
  there's no generator wired into the build.
