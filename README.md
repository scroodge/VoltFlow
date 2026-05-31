# <img src="public/icon-192.png" alt="VoltFlow icon" width="40" height="40" align="center"> VoltFlow

Next.js
React
Supabase
PWA
License

**VoltFlow** is a mobile-first EV charging cockpit for live session tracking, deterministic ETA, energy delivery, tariff-aware cost estimates, and charging history.
**VoltFlow** — мобильная панель для контроля зарядки электромобиля: живые сессии, точный ETA, расчет энергии, стоимость по тарифу и история зарядок.

## **Установить на телефон:** [инструкция для iPhone и Android](INSTALL.md)

Рабочая версия проекта: [https://volt-flow-beige.vercel.app/](https://volt-flow-beige.vercel.app/)

## Project docs / Документация проекта

- [AGENTS.md](AGENTS.md) — required instructions for AI/coding agents, especially Next.js 16 and VoltFlow Mate charging-history rules.
- [SKILLS.md](SKILLS.md) — current project skills, safe-change workflow, and feature roadmap discipline.
- [INSTALL.md](INSTALL.md) — user-facing PWA install guide for iPhone, iPad, and Android.
- [supabase/TELEMETRY.md](supabase/TELEMETRY.md) — VoltFlow Mate telemetry storage model, retention, analytics APIs, and ingest compatibility notes.
- [supabase/BYDMATE_APK_API.md](supabase/BYDMATE_APK_API.md) — Android APK cloud ingest contract.
- [supabase/MIGRATIONS_AUDIT.md](supabase/MIGRATIONS_AUDIT.md) — migration-chain audit and one-at-a-time migration workflow.

## Language / Язык

- [English](#english)
- [Русский](#русский)

---

## English

### Overview

VoltFlow helps EV drivers model and track AC charging sessions without talking directly to charger hardware. The app anchors every charging session to timestamps in Postgres, then recomputes battery percent, delivered kWh, estimated cost, and remaining time from wall-clock math. That makes refreshes, reconnects, and PWA restores predictable.

### Highlights

- **Live charging cockpit** with battery progress, elapsed time, remaining time, kWh, cost, and AC power.
- **Vehicle profiles** for usable battery capacity, wallbox power, and AC efficiency.
- **Tariff-aware estimates** with local currency preferences: EUR, USD, BYN, and RUB.
- **Supabase Auth + RLS** so users only read and update their own vehicles and sessions.
- **Realtime session sync** through Supabase updates on `charging_sessions`.
- **Installable PWA** with app manifest, service worker, icons, and iOS home-screen support.
- **Mobile-first shell** optimized for thumb-friendly controls and safe-area navigation.
- **Internationalization** for English, Belarusian, and Russian.
- **BYD YUAN UP knowledge base** with Telegram-style guides, FAQ, accessories, spare parts, and admin CMS.
- **Semantic knowledge search** powered by OpenAI embeddings.
- **VoltFlow Mate live telemetry** ingestion for vehicle snapshots, history, and trip tracks.
- **VoltFlow Mate charging history** with delayed completion sample preservation for SOC/cell-voltage tails.
- **Trip history** with per-trip energy summary, sample timeline, and GPS track viewer.
- **Vehicle analytics** — day/week/month/quarter/year telemetry charts with period KPI summary, bar charts for week+, mileage, efficiency, phantom drain, consumption vs outside temp, SOH trend, monthly stats, cost/km, lifetime map, route insights (repeat-trip clustering, maps, rename, parking spots), CSV/JSON export. Primary entry: **History → Analytics** (`/history?tab=analytics`); Vehicle page links via teaser when VoltFlow Mate is connected.
- **Home charger geofence** — auto-apply home tariff when charging starts inside configured GPS radius.
- **Charge finish projection** — estimated finish time and SOC-at-07:00 on the active charging screen.
- **Knowledge search** standalone page at `/knowledge/search` for full-text article lookup.
- **Web push notifications** for completed charging sessions when VAPID keys are configured.
- **Developer diagnostics** with fixture pages, Wildberries product search, and a `/dev/site/` mirror that bypasses auth for local development.

### Tech Stack


| Layer              | Technology                                                      |
| ------------------ | --------------------------------------------------------------- |
| Framework          | Next.js 16 App Router                                           |
| UI                 | React 19, Tailwind CSS 4, shadcn-style components, lucide-react |
| State & data       | TanStack Query, Zustand                                         |
| Forms & validation | React Hook Form, Zod                                            |
| Backend            | Supabase Auth, Postgres, Realtime, Row Level Security           |
| PWA                | `manifest.ts`, production service worker, app icons, web push   |
| Deployment target  | Vercel or any Node-compatible Next.js host                      |


### Current Progress

This repository already contains the main production surface of VoltFlow. Future work should extend it in place and preserve the working behavior listed here.

#### Working product areas

- Public/marketing entry point and authenticated mobile app shell.
- Supabase authentication flows: login, forgot password, reset password, auth callback, and protected app routes.
- Vehicle profile management: create and edit cars with battery, wallbox, efficiency, tariff, and currency preferences.
- Charging cockpit: active session screen, progress ring, stats, start/stop actions, charging delta card, deterministic wall-clock fallback calculations, and realtime session sync.
- Charging history: session list, detail screen, and VoltFlow Mate session-sample charts through `/api/vehicle/charging-sessions/[sessionId]/samples`.
- Trip history: trip list with energy summary via `/api/vehicle/trips`, per-trip sample timeline via `/api/vehicle/trips/[tripId]/samples`, and GPS track via `/api/vehicle/trips/[tripId]/track`.
- **History analytics tab:** full telemetry analytics in `VehicleAnalyticsPanels` at `/history?tab=analytics` — range picker (day/week/month/quarter/year), period summary KPIs with loading states, line charts (day) and daily/weekly bar charts (week+), phantom drain, consumption vs outside temp, SOH, monthly stats, route insights, cost/km, lifetime map, and export.
- **Route insights:** GPS track fingerprint clustering (`GET /api/vehicle/analytics?type=route-insights`), user route names and parking-spot flags in `bydmate_route_labels` (`PUT /api/vehicle/route-labels`), collapsible cards with map preview and per-route consumption vs temp stats.
- Vehicle page: analytics teaser linking to History when Mate is connected; analytics panels also render on `/dev/vehicle` fixtures and remain accessible when live telemetry is stale.
- Knowledge search: standalone page at `/knowledge/search` with full-text lookup backed by `GET /api/knowledge/search`.
- Dashboard, settings, history, charging, and vehicle pages under the authenticated app layout.
- Installable PWA behavior with manifest, service worker registration in production, branded SVG/PNG assets, and mobile safe-area navigation.
- Internationalization across English, Belarusian, and Russian.
- Web push infrastructure for charge-threshold/completion notifications when VAPID keys are configured.

#### VoltFlow Mate and vehicle telemetry

- Cloud ingest endpoint: `POST /api/bydmate/telemetry`.
- Accepted payloads: single sample, `{ "samples": [...] }`, and direct JSON array batches.
- API-key and vehicle-id checks through profile VoltFlow Mate cloud key and `X-Vehicle-Id`.
- Normalized live snapshot storage in `bydmate_live_snapshots`.
- Append-only historical samples in `bydmate_telemetry_samples`.
- Hourly rollups in `bydmate_telemetry_hourly`.
- Server-side trip inference in `bydmate_trips` and GPS track persistence in `bydmate_trip_track_points`.
- Trip API endpoints: `GET /api/vehicle/trips`, `GET /api/vehicle/trips/[tripId]/samples`, `GET /api/vehicle/trips/[tripId]/track`.
- Charging samples are intentionally kept in live/history telemetry but excluded from driving-trip extension.
- GPS sanity filtering and suspicious point dropping before track persistence.
- Di+ raw payload storage plus materialized columns for SOC, speed, power, cell voltages, temperatures, doors, windows, tires, lights, HVAC, drive state, and diagnostics.
- **90-day raw retention** and **3-year hourly retention** via `purge_old_bydmate_telemetry()` (pg_cron on Pro).
- **Trip regen/traction persist** on `bydmate_trips` at trip close; hourly `regen_kwh_sum` / `traction_kwh_sum` rollups.
- **Realtime live vehicle** via Supabase Realtime on `bydmate_live_snapshots` (replaces 5 s polling).
- **Analytics APIs:** `GET /api/vehicle/telemetry`, `/api/vehicle/analytics` (`monthly`, `phantom`, `cost-per-km`, `period-trips`, `route-insights`), `/api/vehicle/lifetime-map`, `/api/vehicle/export`; `PUT /api/vehicle/route-labels` for route names and park flags.
- **VoltFlow Mate APK (2026-05-30):** 1 s active enqueue, 15 s flush, slim idle payloads, optional GPS privacy switch — see Mate `docs/cloud-telemetry-contract-ru.md`.

#### Knowledge base and Telegram experience

- Telegram-style `/telegram` knowledge app with category browsing, article rendering, generation filters, FAQ, charging guides, calculators, accessories, spare parts, ownership experience, and maintenance guides.
- Server-backed admin CMS for knowledge categories, articles, FAQ, accessories, and spare parts.
- Public article/category routes at `/telegram/article/[slug]` and `/telegram/category/[slug]`.
- Semantic knowledge search through OpenAI embeddings and Supabase RPC/table storage when `OPENAI_API_KEY` is available.
- Fallback/static content in `src/data/telegram/` and typed knowledge helpers in `src/lib/telegram/`.

#### Developer and diagnostic tools

- Dev pages under `/dev`: dashboard, charging, history, vehicle, VoltFlow Mate Di+, vehicle telemetry fixtures, and Wildberries product search (`/dev/api`).
- `/dev/site/` mirror rewrites any app route with auth bypass so protected pages can be viewed in development without a real session.
- Wildberries dev API proxy under `src/app/api/dev/wb/` and debugger UI in `src/components/dev/wb-api-debugger.tsx`.
- VoltFlow Mate parser, sanitizer, range estimate, trip filter, trip energy, telemetry history, app preferences, and push-threshold tests.
- Migration wrapper at `scripts/supabase-migrate-one.mjs` for controlled Supabase migration status/plan/up/down operations.

### Preservation Rules

Before adding features or fixing bugs, read [AGENTS.md](AGENTS.md). The short version:

- Treat Next.js 16 as version-specific. Read the relevant guide in `node_modules/next/dist/docs/` before changing framework APIs, routing, server actions, middleware/proxy behavior, metadata, caching, or file structure.
- Do not assume charging-history data is lost when a chart stops below target SOC. Compare `charging_sessions.started_at`, `charging_sessions.stopped_at`, `charging_sessions.current_percent`, `charging_sessions.target_percent`, `bydmate_telemetry_samples.device_time`, and delayed samples around the stop time.
- Preserve delayed VoltFlow Mate completion samples because target SOC may arrive minutes after VoltFlow marks a session `completed`.
- When fresh VoltFlow Mate live SOC exists, never auto-complete a charging session from mathematical time estimates. Math is display fallback only; completion must wait for live SOC so the 100% cell-voltage tail is captured.
- Keep existing working features untouched unless the task explicitly requires changing them. Prefer narrow, tested edits over broad refactors.

### Getting Started

#### Requirements

- Node.js `22.x`
- npm `10.x`
- Supabase project

#### 1. Install dependencies

```bash
npm install
```

#### 2. Configure environment variables

Copy the example file:

```bash
cp .env.example .env.local
```

Set these values:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Optional features use these values:

```bash
OPENAI_API_KEY=your-openai-api-key
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_SUBJECT=mailto:your@email.com
```

The client uses the anon key with RLS. The service role key is used by server-side admin, knowledge search, and VoltFlow Mate ingestion flows and should never be exposed to the browser. `OPENAI_API_KEY` enables semantic search indexing/search. VAPID keys enable browser push notifications.

#### 3. Prepare Supabase

Run all migrations in timestamp order from:

```text
supabase/migrations/
```

They create and evolve:

- `profiles`
- `cars`
- `charging_sessions`
- `push_subscriptions`
- knowledge CMS tables for categories, articles, FAQ, accessories, spare parts, and semantic search
- VoltFlow Mate telemetry snapshots, samples, trips, and track points
- RLS policies scoped by `auth.uid()`
- profile creation trigger
- `updated_at` trigger
- Realtime publication for `charging_sessions` and `bydmate_live_snapshots`

In Supabase, also enable Realtime for the `charging_sessions` table, confirm the knowledge image storage buckets from the migrations exist if you plan to manage CMS images, and configure Auth redirect URLs:

```text
http://localhost:3000
https://your-production-domain.com
```

#### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Scripts

```bash
npm run dev       # Start Next.js dev server
npm run build     # Create production build
npm run start     # Start production server
npm run test      # Run Node test suite for VoltFlow Mate, app preferences, and push logic
npm run lint      # Run ESLint
npm run db:migrations:status
npm run db:migrations:plan
npm run db:migrations:up
npm run db:migrations:down
```

### Automatic Version Bump

This local clone has a Git `pre-commit` hook at `.git/hooks/pre-commit`.
Every normal commit automatically bumps the patch version in `package.json`
and `package-lock.json`, then stages those files into the same commit.

Example:

```text
0.1.4 -> 0.1.5
```

The hook is local to this machine because `.git/hooks` is not committed to the
repository. If the hook ever needs to be recreated, add this file:

```sh
#!/bin/sh
set -e

node <<'NODE'
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const packagePath = path.join(root, "package.json");
const lockPath = path.join(root, "package-lock.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version);

  if (!match) {
    throw new Error(`Unsupported package version: ${version}`);
  }

  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}${match[4] || ""}`;
}

const packageJson = readJson(packagePath);
const nextVersion = bumpPatch(packageJson.version);

packageJson.version = nextVersion;
writeJson(packagePath, packageJson);

if (fs.existsSync(lockPath)) {
  const lockJson = readJson(lockPath);

  if (typeof lockJson.version === "string") {
    lockJson.version = nextVersion;
  }

  if (lockJson.packages && lockJson.packages[""]) {
    lockJson.packages[""].version = nextVersion;
  }

  writeJson(lockPath, lockJson);
}

console.log(`Version bumped to ${nextVersion}`);
NODE

git add package.json package-lock.json
```

Then make it executable:

```bash
chmod +x .git/hooks/pre-commit
```

### Charging Model

VoltFlow stores immutable session inputs such as starting percent, target percent, battery capacity, charger power, efficiency, tariff, and timestamps. Runtime values are recomputed from `started_at` plus the current wall clock:

- current battery percent
- delivered AC energy
- estimated cost
- ETA and remaining duration
- completed or stopped state

Those values are persisted back to Postgres so browser refreshes, realtime subscribers, and restored PWA sessions stay consistent.

### PWA Development

- App manifest: `src/app/manifest.ts`
- Service worker: `public/sw.js`
- Registration component: `src/components/sw-register.tsx`
- SVG brand assets: `public/voltflow-icon.svg`, `public/voltflow-logo.svg`
- PNG icons: `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`
- Start URL: `/telegram`
- Display mode: `standalone`

The service worker is registered only in production builds, so test installability with:

```bash
npm run build
npm run start
```

Then open the deployed domain or local production server in the browser.

User-facing install instructions live in [INSTALL.md](INSTALL.md).

### Project Structure

```text
src/app/                 Routes, layouts, manifest, auth callback
src/app/api/             VoltFlow Mate, vehicle telemetry, push, knowledge, and dev APIs
src/actions/             Server actions for cars and sessions
src/components/          UI, brand, dashboard, charging, history, telegram, admin, settings
src/hooks/               Query hooks, VoltFlow Mate hooks, session, translation, ticking clock
src/lib/                 Charging math, VoltFlow Mate logic, i18n, Supabase clients, utilities
src/stores/              Local UI and preference stores
src/types/               Database types
supabase/migrations/     Database schema, RLS, triggers, Realtime setup
supabase/*.md            Telemetry, APK contract, and migration audit docs
public/                  PWA icons, service worker, brand assets
```

### Brand

- Base: `#12151C`
- Card: `#171B24`
- Border: `#273040`
- Text: `#F8FAFC`
- Primary green: `#00E676`
- Cyan: `#00D1FF`
- Accent blue: `#2962FF`
- Typography: Space Grotesk with Inter/system fallback

### License

MIT License. See [LICENSE](LICENSE).

---

## Русский

### Обзор

VoltFlow помогает владельцам электромобилей моделировать и отслеживать AC-зарядку без прямого подключения к зарядной станции. Каждая сессия привязана к временным меткам в Postgres, а процент батареи, переданные кВт·ч, примерная стоимость и оставшееся время пересчитываются по реальному времени. Поэтому обновление страницы, восстановление PWA и повторное подключение остаются предсказуемыми.

### Возможности

- **Живая панель зарядки** с прогрессом батареи, прошедшим временем, ETA, кВт·ч, стоимостью и AC-мощностью.
- **Профили автомобилей** с полезной емкостью батареи, мощностью wallbox и эффективностью AC-зарядки.
- **Расчет стоимости по тарифу** с локальными валютами: EUR, USD, BYN и RUB.
- **Supabase Auth + RLS**, чтобы пользователь видел и менял только свои автомобили и сессии.
- **Realtime-синхронизация** через обновления таблицы `charging_sessions`.
- **Устанавливаемая PWA** с manifest, service worker, иконками и поддержкой iOS Home Screen.
- **Mobile-first интерфейс** с крупными touch-контролами и safe-area навигацией.
- **Локализация** на английский, белорусский и русский языки.
- **База знаний BYD YUAN UP** в Telegram-формате: гайды, FAQ, аксессуары, запчасти и admin CMS.
- **Семантический поиск** по базе знаний через OpenAI embeddings.
- **VoltFlow Mate live telemetry** для live-снимков автомобиля, истории и треков поездок.
- **История зарядки VoltFlow Mate** с сохранением отложенных completion-сэмплов для SOC и хвоста cell-voltage.
- **История поездок** с energy summary, timeline сэмплов и просмотром GPS-трека.
- **Аналитика автомобиля** — графики телеметрии за день/неделю/месяц/квартал/год с KPI-сводкой за период, bar charts для week+, пробег, эффективность, phantom drain, расход vs внешняя температура, тренд SOH, месячная сводка, стоимость/км, карта поездок, route insights (кластеризация повторяющихся маршрутов, карты, переименование, парковки), экспорт CSV/JSON. Основной вход: **История → Аналитика** (`/history?tab=analytics`); со страницы автомобиля — teaser при подключённом VoltFlow Mate.
- **Геозона домашней зарядки** — автоматический домашний тариф при старте зарядки внутри заданного GPS-радиуса.
- **Прогноз окончания зарядки** — оценочное время завершения и SOC в 07:00 на экране активной сессии.
- **Поиск по базе знаний** на отдельной странице `/knowledge/search`.
- **Web push-уведомления** о завершении зарядки, если настроены VAPID-ключи.
- **Dev-диагностика** с fixture-страницами, поиском Wildberries и `/dev/site/` зеркалом для обхода авторизации в dev-режиме.

### Стек


| Слой               | Технологии                                                      |
| ------------------ | --------------------------------------------------------------- |
| Фреймворк          | Next.js 16 App Router                                           |
| UI                 | React 19, Tailwind CSS 4, shadcn-style компоненты, lucide-react |
| Состояние и данные | TanStack Query, Zustand                                         |
| Формы и валидация  | React Hook Form, Zod                                            |
| Бэкенд             | Supabase Auth, Postgres, Realtime, Row Level Security           |
| PWA                | `manifest.ts`, production service worker, app icons, web push   |
| Деплой             | Vercel или любой Node-compatible хостинг для Next.js            |


### Текущий прогресс

В репозитории уже есть основная рабочая поверхность VoltFlow. Новые функции нужно добавлять поверх существующего поведения, не ломая уже работающие сценарии.

#### Рабочие зоны продукта

- Public/marketing entry point и защищенная mobile-first оболочка приложения.
- Supabase auth: login, forgot password, reset password, auth callback и protected routes.
- Профили автомобилей: создание и редактирование машины с батареей, wallbox, эффективностью AC-зарядки, тарифом и валютой.
- Экран зарядки: активная сессия, progress ring, stats, start/stop actions, charging delta card, deterministic wall-clock fallback и realtime-синхронизация.
- История зарядок: список, detail screen и графики VoltFlow Mate samples через `/api/vehicle/charging-sessions/[sessionId]/samples`.
- История поездок: список с energy summary через `/api/vehicle/trips`, timeline сэмплов через `/api/vehicle/trips/[tripId]/samples`, GPS-трек через `/api/vehicle/trips/[tripId]/track`.
- **Вкладка «Аналитика» в Истории:** полная аналитика в `VehicleAnalyticsPanels` на `/history?tab=analytics` — выбор периода, KPI-сводка с loading-состояниями, line/bar charts, phantom drain, расход vs температура, SOH, месячная сводка, route insights, стоимость/км, lifetime map и экспорт.
- **Route insights:** кластеризация GPS-треков (`GET /api/vehicle/analytics?type=route-insights`), имена маршрутов и флаги парковок в `bydmate_route_labels` (`PUT /api/vehicle/route-labels`), карточки с картой и статистикой расхода vs температура.
- Страница автомобиля: teaser со ссылкой на Историю; панели также на `/dev/vehicle` и доступны при stale live telemetry.
- Поиск знаний: отдельная страница `/knowledge/search` с full-text поиском через `GET /api/knowledge/search`.
- Dashboard, settings, history, charging и vehicle pages внутри authenticated app layout.
- PWA: manifest, production service worker, бренд-ассеты, установка на home screen и safe-area navigation.
- Локализация на английский, белорусский и русский.
- Web push инфраструктура для charge-threshold/completion уведомлений при настроенных VAPID ключах.

#### VoltFlow Mate и телеметрия автомобиля

- Cloud ingest endpoint: `POST /api/bydmate/telemetry`.
- Поддерживаются single sample, `{ "samples": [...] }` и прямой JSON array batch.
- Проверки API key и `X-Vehicle-Id` через профильный VoltFlow Mate cloud key.
- Live-состояние хранится в `bydmate_live_snapshots`.
- Исторические сэмплы хранятся append-only в `bydmate_telemetry_samples`.
- Hourly rollups хранятся в `bydmate_telemetry_hourly`.
- Trips строятся сервером в `bydmate_trips`, GPS track points сохраняются в `bydmate_trip_track_points`.
- Trip API: `GET /api/vehicle/trips`, `GET /api/vehicle/trips/[tripId]/samples`, `GET /api/vehicle/trips/[tripId]/track`.
- Charging samples сохраняются в live/history telemetry, но не создают и не продлевают driving trips.
- До сохранения треков применяется фильтрация подозрительных GPS-точек.
- Di+ сохраняется raw JSON и частично материализуется в колонки для SOC, speed, power, cell voltages, temperatures, doors, windows, tires, lights, HVAC и diagnostics.
- **Retention 90 дней raw / 3 года hourly** через `purge_old_bydmate_telemetry()` (pg_cron на Pro).
- **Regen/traction на поездке** сохраняются в `bydmate_trips` при закрытии; hourly `regen_kwh_sum` / `traction_kwh_sum`.
- **Realtime live vehicle** через Supabase Realtime на `bydmate_live_snapshots` (вместо polling каждые 5 с).
- **Analytics API:** `GET /api/vehicle/telemetry`, `/api/vehicle/analytics` (`monthly`, `phantom`, `cost-per-km`, `period-trips`, `route-insights`), `/api/vehicle/lifetime-map`, `/api/vehicle/export`; `PUT /api/vehicle/route-labels`.
- **VoltFlow Mate APK (2026-05-30):** enqueue 1 с в движении/зарядке, flush 15 с, slim idle payload, переключатель GPS privacy — см. `docs/cloud-telemetry-contract-ru.md` в репозитории Mate.

#### База знаний и Telegram experience

- Telegram-style `/telegram` приложение: категории, статьи, generation filters, FAQ, charging guides, calculators, accessories, spare parts, ownership experience и maintenance guides.
- Admin CMS для categories, articles, FAQ, accessories и spare parts.
- Public routes для статей и категорий: `/telegram/article/[slug]`, `/telegram/category/[slug]`.
- Семантический поиск через OpenAI embeddings и Supabase при наличии `OPENAI_API_KEY`.
- Static/fallback контент находится в `src/data/telegram/`, typed helpers — в `src/lib/telegram/`.

#### Dev и диагностика

- Dev pages под `/dev`: dashboard, charging, history, vehicle, VoltFlow Mate Di+, vehicle telemetry fixtures и Wildberries product search (`/dev/api`).
- `/dev/site/` зеркало перезаписывает любой app route с bypass авторизации — защищённые страницы открываются в dev без реальной сессии.
- Wildberries dev API proxy находится в `src/app/api/dev/wb/`, UI debugger — в `src/components/dev/wb-api-debugger.tsx`.
- Покрыты тестами VoltFlow Mate parser, sanitizer, range estimate, trip filter, trip energy, telemetry history, app preferences и push thresholds.
- Контролируемые миграции Supabase выполняются через `scripts/supabase-migrate-one.mjs`.

### Правила сохранения рабочей функциональности

Перед изменениями читайте [AGENTS.md](AGENTS.md). Короткая версия:

- Next.js 16 считать отдельной версией с возможными breaking changes. Перед изменениями framework APIs, routing, server actions, middleware/proxy, metadata, caching или file structure читать релевантный guide в `node_modules/next/dist/docs/`.
- Если график истории зарядки остановился ниже target SOC, не считать данные потерянными. Сначала сравнить `charging_sessions.started_at`, `charging_sessions.stopped_at`, `charging_sessions.current_percent`, `charging_sessions.target_percent`, `bydmate_telemetry_samples.device_time` и delayed samples вокруг stop time.
- Сохранять отложенные VoltFlow Mate completion samples: target SOC может прийти через несколько минут после того, как VoltFlow отметил сессию `completed`.
- Если есть свежий VoltFlow Mate live SOC, не auto-complete зарядную сессию по математической оценке времени. Математика может быть только display fallback; завершение должно ждать live SOC, чтобы сохранить 100% cell-voltage tail.
- Не трогать уже рабочие сценарии без прямой необходимости. Предпочитать узкие изменения с тестами вместо широких рефакторингов.

### Быстрый старт

#### Требования

- Node.js `22.x`
- npm `10.x`
- проект Supabase

#### 1. Установите зависимости

```bash
npm install
```

#### 2. Настройте переменные окружения

Скопируйте пример:

```bash
cp .env.example .env.local
```

Заполните значения:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Опциональные функции используют эти значения:

```bash
OPENAI_API_KEY=your-openai-api-key
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_SUBJECT=mailto:your@email.com
```

Клиентская часть использует anon key вместе с RLS. Service role key используется серверными admin-, search- и VoltFlow Mate-сценариями и не должен попадать в браузер. `OPENAI_API_KEY` включает семантический поиск. VAPID-ключи включают browser push-уведомления.

#### 3. Подготовьте Supabase

Выполните все миграции по порядку timestamp из каталога:

```text
supabase/migrations/
```

Они создают и обновляют:

- `profiles`
- `cars`
- `charging_sessions`
- `push_subscriptions`
- CMS-таблицы базы знаний для разделов, статей, FAQ, аксессуаров, запчастей и семантического поиска
- VoltFlow Mate telemetry snapshots, samples, trips и track points
- RLS-политики через `auth.uid()`
- триггер создания профиля
- триггер `updated_at`
- Realtime-публикацию для `charging_sessions` и `bydmate_live_snapshots`

Также включите Realtime для таблицы `charging_sessions`, проверьте наличие storage buckets из миграций для загрузки изображений из knowledge admin, если планируете управлять CMS-контентом, и добавьте Auth Redirect URLs:

```text
http://localhost:3000
https://your-production-domain.com
```

#### 4. Запустите локально

```bash
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000).

### Скрипты

```bash
npm run dev       # Запуск Next.js dev server
npm run build     # Production build
npm run start     # Production server
npm run test      # Node test suite для VoltFlow Mate, app preferences и push logic
npm run lint      # ESLint
npm run db:migrations:status
npm run db:migrations:plan
npm run db:migrations:up
npm run db:migrations:down
```

### Автоматическое обновление версии

В этом локальном клоне настроен Git `pre-commit` hook:
`.git/hooks/pre-commit`. При каждом обычном коммите он автоматически
увеличивает patch-версию в `package.json` и `package-lock.json`, а затем
добавляет эти файлы в тот же коммит.

Пример:

```text
0.1.4 -> 0.1.5
```

Hook локальный для этой машины, потому что `.git/hooks` не коммитится в
репозиторий. Если его нужно восстановить, используйте инструкцию из английского
раздела Automatic Version Bump и затем выполните:

```bash
chmod +x .git/hooks/pre-commit
```

### Модель зарядки

VoltFlow хранит неизменяемые входные данные сессии: стартовый процент, цель, емкость батареи, мощность зарядки, эффективность, тариф и временные метки. Текущие значения пересчитываются из `started_at` и текущего времени:

- текущий процент батареи
- переданная AC-энергия
- примерная стоимость
- ETA и оставшееся время
- статус завершения или остановки

Эти значения сохраняются обратно в Postgres, поэтому обновление страницы, realtime-подписчики и восстановленная PWA видят согласованное состояние.

### PWA для разработки

- Manifest: `src/app/manifest.ts`
- Service worker: `public/sw.js`
- Регистрация service worker: `src/components/sw-register.tsx`
- SVG-бренд: `public/voltflow-icon.svg`, `public/voltflow-logo.svg`
- PNG-иконки: `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`
- Start URL: `/telegram`
- Display mode: `standalone`

Service worker регистрируется только в production build, поэтому installability проверяйте так:

```bash
npm run build
npm run start
```

Затем откройте production-домен или локальный production server в браузере.

Пользовательская инструкция по установке находится в [INSTALL.md](INSTALL.md).

### Структура проекта

```text
src/app/                 Роуты, layout-файлы, manifest, auth callback
src/app/api/             VoltFlow Mate, vehicle telemetry, push, knowledge и dev APIs
src/actions/             Server actions для автомобилей и сессий
src/components/          UI, бренд, dashboard, charging, history, telegram, admin, settings
src/hooks/               Query hooks, VoltFlow Mate hooks, session, translation, ticking clock
src/lib/                 Charging math, VoltFlow Mate logic, i18n, Supabase clients, utilities
src/stores/              Локальные UI и preference stores
src/types/               Типы базы данных
supabase/migrations/     Схема БД, RLS, triggers, Realtime
supabase/*.md            Telemetry, APK contract и migration audit docs
public/                  PWA icons, service worker, brand assets
```

### Бренд

- Основа: `#12151C`
- Карточки: `#171B24`
- Границы: `#273040`
- Текст: `#F8FAFC`
- Основной зеленый: `#00E676`
- Cyan: `#00D1FF`
- Accent blue: `#2962FF`
- Типографика: Space Grotesk с fallback на Inter/system

### Лицензия

MIT License. Подробности в [LICENSE](LICENSE).
