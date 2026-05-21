# <img src="public/icon-192.png" alt="VoltFlow icon" width="40" height="40" align="center"> VoltFlow


![Next.js](https://img.shields.io/badge/Next.js-16.2.6-black?style=for-the-badge&logo=nextdotjs)
![React](https://img.shields.io/badge/React-19.2.4-149eca?style=for-the-badge&logo=react&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20Postgres%20%2B%20Realtime-3ecf8e?style=for-the-badge&logo=supabase&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-installable-00e676?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-f8fafc?style=for-the-badge)

**VoltFlow** is a mobile-first EV charging cockpit for live session tracking, deterministic ETA, energy delivery, tariff-aware cost estimates, and charging history.
**VoltFlow** — мобильная панель для контроля зарядки электромобиля: живые сессии, точный ETA, расчет энергии, стоимость по тарифу и история зарядок.


**Для установки на телефон:** [инструкция для iPhone и Android](#iPhone и iPad)
---

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
- **BYDMate live telemetry** ingestion for vehicle snapshots, history, and trip tracks.
- **Web push notifications** for completed charging sessions when VAPID keys are configured.

### Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 App Router |
| UI | React 19, Tailwind CSS 4, shadcn-style components, lucide-react |
| State & data | TanStack Query, Zustand |
| Forms & validation | React Hook Form, Zod |
| Backend | Supabase Auth, Postgres, Realtime, Row Level Security |
| PWA | `manifest.ts`, production service worker, app icons, web push |
| Deployment target | Vercel or any Node-compatible Next.js host |

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

The client uses the anon key with RLS. The service role key is used by server-side admin, knowledge search, and BYDMate ingestion flows and should never be exposed to the browser. `OPENAI_API_KEY` enables semantic search indexing/search. VAPID keys enable browser push notifications.

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
- BYDMate telemetry snapshots, samples, trips, and track points
- RLS policies scoped by `auth.uid()`
- profile creation trigger
- `updated_at` trigger
- Realtime publication for `charging_sessions`

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
npm run lint      # Run ESLint
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

### PWA Install

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

#### iPhone and iPad

1. Open VoltFlow in **Safari**. iOS does not install PWAs from Chrome, Firefox, or in-app browsers.
2. Sign in or open the page you want the app icon to launch from.
3. Tap **Share** in the Safari toolbar.
4. Choose **Add to Home Screen**.
5. Keep the suggested name or rename it to `VoltFlow`.
6. Tap **Add**. VoltFlow appears on the Home Screen and opens in standalone mode.

Notes for iOS:

- If **Add to Home Screen** is missing, reload the page in Safari and make sure the site is served over HTTPS, or from `localhost` during local testing.
- Push notifications require the app to be installed, notification permission to be granted, and VAPID keys to be configured on the deployment.
- To update the cached app shell, open the installed app after a new deployment; Safari may keep some assets cached briefly.

#### Android

1. Open VoltFlow in **Chrome**.
2. Wait for the install prompt, or open the Chrome menu.
3. Tap **Install app** or **Add to Home screen**.
4. Confirm the install. VoltFlow appears in the launcher and opens in standalone mode.
5. When prompted, allow notifications if you want charge-complete alerts.

Notes for Android:

- If the install prompt does not appear, use **Chrome menu -> Add to Home screen**.
- The app must be served over HTTPS in production.
- Push notifications require `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.
- Android WebView or Telegram in-app browser may not show the install prompt; open the same URL in Chrome.

### Project Structure

```text
src/app/                 Routes, layouts, manifest, auth callback
src/actions/             Server actions for cars and sessions
src/components/          UI, brand, dashboard, charging, history, settings
src/hooks/               Query, session, translation, and ticking-clock hooks
src/lib/                 Charging math, i18n, Supabase clients, utilities
src/stores/              Local UI and preference stores
src/types/               Database types
supabase/migrations/     Database schema, RLS, triggers, Realtime setup
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
- **BYDMate live telemetry** для live-снимков автомобиля, истории и треков поездок.
- **Web push-уведомления** о завершении зарядки, если настроены VAPID-ключи.

### Стек

| Слой | Технологии |
| --- | --- |
| Фреймворк | Next.js 16 App Router |
| UI | React 19, Tailwind CSS 4, shadcn-style компоненты, lucide-react |
| Состояние и данные | TanStack Query, Zustand |
| Формы и валидация | React Hook Form, Zod |
| Бэкенд | Supabase Auth, Postgres, Realtime, Row Level Security |
| PWA | `manifest.ts`, production service worker, app icons, web push |
| Деплой | Vercel или любой Node-compatible хостинг для Next.js |

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

Клиентская часть использует anon key вместе с RLS. Service role key используется серверными admin-, search- и BYDMate-сценариями и не должен попадать в браузер. `OPENAI_API_KEY` включает семантический поиск. VAPID-ключи включают browser push-уведомления.

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
- BYDMate telemetry snapshots, samples, trips и track points
- RLS-политики через `auth.uid()`
- триггер создания профиля
- триггер `updated_at`
- Realtime-публикацию для `charging_sessions`

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
npm run lint      # ESLint
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

### Установка PWA

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

#### iPhone и iPad

1. Откройте VoltFlow в **Safari**. iOS не устанавливает PWA из Chrome, Firefox или встроенных браузеров.
2. Войдите в аккаунт или откройте страницу, с которой приложение должно стартовать.
3. Нажмите **Share** в панели Safari.
4. Выберите **Add to Home Screen**.
5. Оставьте предложенное имя или переименуйте приложение в `VoltFlow`.
6. Нажмите **Add**. VoltFlow появится на Home Screen и будет открываться в standalone-режиме.

Заметки для iOS:

- Если пункта **Add to Home Screen** нет, перезагрузите страницу в Safari и убедитесь, что сайт открыт по HTTPS, либо с `localhost` при локальном тесте.
- Push-уведомления требуют установленного PWA, выданного разрешения на уведомления и настроенных VAPID-ключей на деплое.
- После нового деплоя откройте установленное приложение, чтобы оно подтянуло свежие assets; Safari может недолго держать старый cache.

#### Android

1. Откройте VoltFlow в **Chrome**.
2. Дождитесь install prompt или откройте меню Chrome.
3. Нажмите **Install app** или **Add to Home screen**.
4. Подтвердите установку. VoltFlow появится в launcher и будет открываться в standalone-режиме.
5. Разрешите уведомления, если нужны alerts о завершении зарядки.

Заметки для Android:

- Если install prompt не появился, используйте **Chrome menu -> Add to Home screen**.
- В production приложение должно открываться по HTTPS.
- Push-уведомления требуют `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` и `VAPID_SUBJECT`.
- Android WebView или встроенный браузер Telegram могут не показывать установку; откройте тот же URL в Chrome.

### Структура проекта

```text
src/app/                 Роуты, layout-файлы, manifest, auth callback
src/actions/             Server actions для автомобилей и сессий
src/components/          UI, бренд, dashboard, charging, history, settings
src/hooks/               Query, session, translation и ticking-clock hooks
src/lib/                 Charging math, i18n, Supabase clients, utilities
src/stores/              Локальные UI и preference stores
src/types/               Типы базы данных
supabase/migrations/     Схема БД, RLS, triggers, Realtime
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
