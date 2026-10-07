# VoltFlow FAQ demo pack

Local screenshot and Russian draft-post package for `@voltflowfaq`.
The channel has not been created or published by this workflow.

## Review

Open [the screenshot gallery](screenshots/current/gallery.html), then
[the Russian post drafts](POSTS.ru.md). The current run's machine-readable evidence
is [manifest.json](screenshots/current/manifest.json). Only files listed in that
manifest belong to the current capture; older PNGs elsewhere are previous attempts.
`complete: true` means the automated capture passed. Visual approval is separate.

Current status (2026-10-07): **not ready for publication**. The approved
selector identity and stable-empty-query fixes are implemented. Charge detail
passed three normal loads and three loads with telemetry queries delayed eight
seconds, including both dropdowns, without recorded browser/HTTP errors. Earlier
screenshots remain provisional until a clean full capture and visual review.
The latest full attempt stopped after ten screens when the stronger check
rejected an unready car-settings page. Earlier contact-sheet review found
analytics loading placeholders and explorer-preview trip data, so those images
must not be used as evidence of populated fictional history. Full capture also
encountered development manifest/hydration errors; these are separate from the
verified charge-detail fallback fix.

## Feature coverage

| Area | Screenshot |
| --- | --- |
| Dashboard and parked charging estimate | `01-dashboard` |
| Manual receipt entry, form only | `02-manual-charge` |
| Charging history and completed-session detail | `03-charging-history`, `04-charge-detail` |
| Trips and period analytics | `05-trips`, `06-analytics` |
| Vehicle SOC, battery and available sensor values | `07-vehicle` |
| Service log and cost statistics | `08-service`, `09-service-stats` |
| Preferences, providers and vehicle parameters | `10-settings`, `11-car-settings` |
| Knowledge home, article, FAQ and calculator | `12-knowledge` through `15-tools` |
| Accessories, spare parts and service catalog | `16-accessories` through `18-service-catalog` |
| Simulated active charging | `19-live-charging`, `20-charging-vehicle` |

Long authenticated screens have additional `-panel-NN.png` images showing their
internal scroll area. PNGs are captured at 390×844 CSS pixels, DPR 2, dark theme,
Russian locale and Europe/Minsk timezone. Public pages can have taller full-page
images. Each image carries a demo-data label; it is applied by the capture harness.

## Fictional data

The fixtures are app-owned demonstration records in isolated local Postgres.
Browser preferences are set through the normal UI and stay in the disposable browser
context's localStorage. This does not change ownership/storage of real user data.

One BYD Yuan Up with a 45.1 kWh battery; four completed charges; twelve trips over
21 days totaling 482 km; three service records totaling 175 BYN; illustrative sensor
values; demo knowledge, FAQ, accessory, part and service-provider entries.
The active-charge scenario temporarily adds a fifth, open session and is restored
to the parked baseline after capture. No real account or vehicle is used.

The receipt example is 51% → 86%, AC efficiency 98%, tariff 0.55 BYN/kWh:
16.107 kWh from the grid and 8.86 BYN. The detail UI rounds energy to 16.11 kWh.
Provider names do not make these fictional prices current provider tariffs.

## Reproduce locally

Start OrbStack first. These scripts require the isolated demo project configured
on loopback ports 55321 (API), 55322 (Postgres) and 3037 (app).

```sh
node scripts/telegram-demo-stack.mjs
node scripts/telegram-demo-schema.mjs
node scripts/telegram-demo-seed.mjs
node scripts/telegram-demo-app.mjs
```

In a second terminal:

```sh
node scripts/telegram-demo-capture.mjs
node scripts/telegram-demo-gallery.mjs
# Focused charge-detail regression check (existing local fixtures):
node scripts/telegram-demo-verify-detail.mjs
node scripts/telegram-demo-verify-detail.mjs --delay-live
```

The schema helper replays four existing, idempotent schema additions needed by
current read paths. It checks the demo ports/container and refuses a database
containing other accounts. It does not reset volumes or connect to production.
The stack script prepares a temporary migration copy for a new stack; its two
historical compatibility adjustments remain local to that copy.

The app uses `.next-telegram-demo` and Webpack development mode. Multi-page
Turbopack captures repeatedly hit missing lazy chunks and a Select render loop;
Webpack rendered the detail once without changing app components, but a later
run reproduced the Select error, so changing bundlers is not a confirmed fix.
Project env-file keys
are blanked before the local endpoints and dummy loopback-only OpenAI settings are
installed, preventing unset demo variables from inheriting project secrets.

## Verification boundaries

The harness checks local HTTP failures and browser errors. Browser requests outside
the two permitted loopback ports are blocked. Vercel analytics scripts are replaced
with empty local responses; release discovery is replaced with an empty result so
the server does not contact GitHub for that feature. Expected report-only CSP
warnings are retained separately in `browserWarnings`; they are not hidden errors.

Screenshots prove these UI states against local fixtures. They do not prove real
Mate telemetry delivery, auto-start/stop detection, remote commands, Telegram
pairing or message delivery, web push, semantic search, GPS routes, uploads, exports,
or signup/recovery. GPS is intentionally absent. Premium/admin operations are outside
this pack. The manual-entry image shows the form; no receipt is submitted there.
This is broad user-facing screen coverage, not a claim that every integration was
end-to-end tested. Server egress was not packet-audited.

No production build, lint or application test suite is part of this screenshot task.

## Channel preparation

Use the description and pinned introduction in `POSTS.ru.md`; publish the numbered
posts as separate messages, with matching images. The hashtag index links the main
topics. Before posting, review the final gallery, remove any image not listed in the
successful manifest, and check captions against that run. Creating the channel and
posting messages are separate actions; this package does neither.
