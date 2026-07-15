# VoltFlow — архитектура и карта документации

[English version](ARCHITECTURE.md) · Английская версия остаётся каноническим источником для реализации.

**Начните отсюда.** Это единый вводный документ: что такое VoltFlow, как данные проходят
от автомобиля до экрана, какие правила сохраняют их корректность и где искать подробности.
Сначала прочитайте его, затем переходите к предметному документу нужной области.

Сопутствующий репозиторий: **VoltFlow Mate** (`scroodge/BYDMate-own`) — Android-шлюз на
головном устройстве DiLink, который передаёт телеметрию в этот backend.

---

## 1. Что такое VoltFlow

**PWA, рассчитанная прежде всего на мобильные устройства**, для владельцев BYD EV
(платформа BYD YUAN UP / Dolphin). В ней четыре основные части:

1. **Панель зарядки** — живые сессии зарядки с SOC, отпущенными кВт·ч, стоимостью по
   тарифу, ETA и историей. Работает и без live-данных автомобиля: состояние пересчитывается
   из времени по меткам в Postgres.
2. **Телеметрия автомобиля** — принимает state-aware live-данные от VoltFlow Mate, хранит
   и показывает состояние, поездки, GPS-треки и аналитику.
3. **База знаний** — CMS в Telegram-стиле (гайды, FAQ, аксессуары, запчасти) с семантическим
   поиском.
4. **Сервисный журнал** — записи обслуживания и напоминания для каждого автомобиля.

Авторизация, мультитенантность и realtime обеспечиваются Supabase. Каждая пользовательская
таблица защищена Row Level Security, привязанной к `auth.uid()`.

---

## 2. Общая схема (поток данных)

```
      Di+ / autoservice / GPS на головном устройстве DiLink
                              │ локальный опрос раз в 1 с
                              ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ APK VoltFlow Mate                                                                  │
│ Room-очередь доставки • уровни payload • отказ от GPS • повтор по application ACK │
│ движение 1 с | заряд <98% 10 с | хвост заряда 1 с | парковка 30 с                 │
│ отправка: движение/хвост 15 с, bulk-заряд 60 с, парковка по умолчанию 60 с         │
└──────────────────────────────────────┬────────────────────────────────────────────┘
                                       │ HTTPS-батчи, X-API-Key + X-Vehicle-Id
                                       ▼
                    ┌─────────────────────────────────────┐
                    │ POST /api/bydmate/telemetry          │
                    │ аутентификация → нормализация/очистка│
                    │ идемпотентный ingest → fan-out       │
                    └──────────────────┬──────────────────┘
                                       │
       ┌───────────────────────────────┼────────────────────────────────┐
       ▼                               ▼                                ▼
bydmate_live_snapshots       telemetry samples + hourly rollups    поездки + GPS-треки
(одна актуальная строка/      (ограниченная raw-детализация,        (выводятся сервером)
автомобиль, источник          компактная модель для долгого срока)          │
Realtime)                            │                                │
       │                               │                                │
       └──────────────┬────────────────┴───────────────┬────────────────┘
                      ▼                                ▼
          VoltFlow PWA / authenticated APIs     Telegram live widget
          live-панель • зарядка • история       (генерируется сервером, 30 с throttle)
          аналитика • поездки • экспорт

Отдельный путь при выключенном автомобиле: shell-uid `CommandDaemon` опрашивает и подтверждает
команды, а также отправляет сокращённый heartbeat Di+ раз в 60 с, только когда beacon живого
приложения устарел. GPS он не передаёт и параллельно с sender приложения не работает.

Отдельный путь без ADB: автомобили с доступной базой `energydata` могут отправлять готовые итоги
поездок в `/api/bydmate/trip-summaries`. Это только история поездок/расхода — без live-состояния,
зарядки, команд и треков.
```

В PWA приходят два независимых живых канала:

- **Телеметрия автомобиля** отправляется автомобилем и приходит в браузер через **Supabase
  Realtime** по `bydmate_live_snapshots` (без polling).
- **Прогресс сессии зарядки** (`current_percent`, энергия, стоимость) записывается **самой
  PWA** (`ChargingSessionBackgroundSync`) примерно раз в секунду при зарядке и передаётся между
  открытыми вкладками через Supabase Realtime по `charging_sessions`.

> Ingest автомобиля/Mate **никогда** не пишет посекундный SOC в `charging_sessions`. Он только
> создаёт/закрывает строки сессий и заполняет поля момента остановки. Посекундный прогресс
> требует открытой PWA. Это разделение — самая частая причина недопонимания; см. §4.

Telegram Mini App (`/telegram`) сейчас является публичной базой знаний. Он не читает головное
устройство DiLink и не показывает приватную live-телеметрию. Отдельный Telegram live widget
создаётся на сервере после принятого telemetry sample, поэтому остаётся полезным при закрытой PWA.

---

## 3. Стек

| Слой | Технология |
| --- | --- |
| Framework | Next.js 16 App Router + React 19 |
| UI | Tailwind CSS 4, shadcn-style components, lucide-react |
| State и данные | TanStack Query, Zustand |
| Формы и валидация | React Hook Form, Zod |
| Backend | Supabase: Auth, Postgres, Realtime, RLS, Storage, scheduled jobs |
| PWA | `manifest.ts`, service worker только в production, web push (VAPID) |
| Поиск контента | Структурированная навигация и дополнительный поиск по контенту |
| Деплой | Vercel (приложение) + self-hosted Supabase (детали инфраструктуры в локальном `docs/OPS_LOCAL.md`) |

**Маршруты** лежат в `src/app/`, сгруппированы по auth layout: `(app)/` — авторизованные,
`(auth)/` — login/reset, `(marketing)/` — публичные. API — в `src/app/api/`.

---

## 4. Правила источника истины (инварианты)

Эти правила обеспечивают корректность при обновлении страницы, reconnect и восстановлении PWA.
Нарушение любого из них приводит к типичным ошибкам: зависшему проценту, ложному `completed`,
фантомной сессии. Полные детали — в [CHARGING_SESSIONS.md](CHARGING_SESSIONS.md).

1. **Приоритет SOC/энергии/стоимости зарядки:**
   `fresh live SOC (≤90 s) > in-session telemetry > wall-clock math`.
   Математика — **только fallback для отображения/сохранения**; она никогда не заменяет свежие
   live-данные.
2. **Нельзя математически завершать сессию, пока есть свежий live SOC.** Завершение ждёт
   live SOC, чтобы сохранить 100% cell-voltage tail.
3. **Только PWA пишет в `charging_sessions` каждую секунду.** Если строка выглядит зависшей,
   а `bydmate_telemetry_samples` обновляется, пользователь закрыл PWA — это не ошибка ingest.
4. **Энергия/стоимость зарядки = `SOC_delta% × battery_capacity_kwh ÷ 100 ÷ efficiency`.**
   Ёмкость **на автомобиль/пользователя**, она не хардкодится; эффективность **на тариф**
   (обычно ~98% AC и ~90% fast DC), а не на автомобиль. Счётчик BMS `kwh_charged` измеряет
   **только энергию ячеек** (примерно на 47% ниже сетевой из-за теплового управления) и **не
   должен** использоваться для стоимости — только для диагностики. См.
   [CHARGING_SESSIONS.md §Charging energy & cost](CHARGING_SESSIONS.md).
5. **Автоопределение зарядки использует `charge_power_kw`, но не тяговый `power_kw`**
   (первопричина фантомных сессий 2026-06-03).
6. **`vehicle_id` — мягкий текстовый ключ**, он сопоставляется с `cars.vehicle_alias` →
   telemetry/trip `vehicle_id` точным сравнением строки. FK в базе данных пока нет.
   API истории/сессий обязаны получать alias из автомобиля/сессии, а не подставлять фиксированное
   значение автомобиля в production-коде.
7. **RLS ограничивает каждую пользовательскую таблицу `auth.uid()`.** Service role key — только
   для сервера.
8. **Владение данными определено явно.** Телеметрия, треки, факты поездок/зарядок, состояние
   команд и серверные rollup — пользовательские данные в Postgres. Room-очередь Mate,
   импортированная локальная история и файлы daemon — локальные кэши доставки/работы, но не
   единственный источник облачной истории пользователя. Предпочтения пользователя сохраняют
   существующее client-side владение, пока отдельная функция явно не выберет другое.

---

## 5. Подсистемы: краткая карта

| Подсистема | Что делает | Канонический документ | Ключевой код |
| --- | --- | --- | --- |
| **Telemetry ingest** | Валидирует и сохраняет данные авто; запускает сессии, widget и уведомления; принимает retries/offline-батчи | [supabase/TELEMETRY.md](../supabase/TELEMETRY.md), [supabase/BYDMATE_APK_API.md](../supabase/BYDMATE_APK_API.md) | `src/app/api/bydmate/telemetry/route.ts`, `src/lib/bydmate/*` |
| **Сессии зарядки** | Start/stop, ~1 Hz progress, авто-сессии, reconcile, тарифы | [CHARGING_SESSIONS.md](CHARGING_SESSIONS.md) | `src/lib/charging-*`, `src/lib/bydmate/charging-auto-session*` |
| **Поездки** | Серверный вывод поездок, фильтр мусора, дельты дистанции, GPS-треки | [TRIPS.md](TRIPS.md) | `bydmate_ingest_telemetry` (SQL), `src/lib/bydmate/trip-*` |
| **Аналитика и графики** | History→Analytics, графики поездок, карты маршрутов, route insights | [TRIPS.md](TRIPS.md) | `src/components/vehicle/*`, `src/lib/bydmate/telemetry-*` |
| **Уведомления** | Web push (пороги заряда) + Telegram-события состояния автомобиля | [VEHICLE_STATE_NOTIFICATIONS.md](VEHICLE_STATE_NOTIFICATIONS.md) | `src/lib/push/*`, `src/lib/telegram/*` |
| **Удалённые команды** | Абстрактные команды PWA → Mate poller или shell daemon при выключенном авто (lock, SOC limit, …) | [supabase/BYDMATE_APK_API.md](../supabase/BYDMATE_APK_API.md) | `src/app/api/bydmate/commands/*`, `vehicle_commands` |
| **Premium и retention** | Entitlements, retention телеметрии по тарифу, admin-инструменты | [PREMIUM_ADMIN.md](PREMIUM_ADMIN.md) | `is_user_premium()`, `purge_old_bydmate_telemetry_by_tier()` |
| **База знаний** | CMS контента, поиск и каталог сервисов | README §Features | `src/app/telegram/*` |
| **База данных** | Таблицы, RLS, RPC, enum, storage buckets | [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | `supabase/migrations/` |
| **PWA / shell** | Установка, service worker, мобильная навигация, i18n (en/be/ru) | [INSTALL.md](../INSTALL.md), README §PWA | `src/app/manifest.ts`, `src/components/layout/*` |

---

## 6. Карта документации

### Живой справочник (актуальное поведение — поддерживать в актуальном состоянии)

| Документ | Область |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Английский канонический источник — обзор, поток данных, инварианты, карта документов |
| [ARCHITECTURE.ru.md](ARCHITECTURE.ru.md) | Этот файл — полный русский справочник архитектуры |
| [../README.md](../README.md) | Поверхность продукта, настройка, скрипты, структура проекта |
| [../INSTALL.md](../INSTALL.md) | Пользовательское руководство по установке PWA (RU) |
| [CHARGING_SESSIONS.md](CHARGING_SESSIONS.md) | Синхронизация зарядки, авто-сессии, reconcile, тарифы, энергия/стоимость |
| [TRIPS.md](TRIPS.md) | Жизненный цикл поездки, фильтр мусора, дельты расстояния |
| [VEHICLE_STATE_NOTIFICATIONS.md](VEHICLE_STATE_NOTIFICATIONS.md) | Telegram-события подключения/парковки/отключения |
| [PREMIUM_ADMIN.md](PREMIUM_ADMIN.md) | Entitlements, тарифы retention, admin runbook |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Полная схема, RLS, RPC, enum, storage |
| [../supabase/TELEMETRY.md](../supabase/TELEMETRY.md) | Модель хранения телеметрии, retention, поля Di+, API аналитики |
| [../supabase/BYDMATE_APK_API.md](../supabase/BYDMATE_APK_API.md) | Контракт ingest и команд APK (передача в Mate repo) |

### Процесс / статус

| Документ | Область |
| --- | --- |
| [PRODUCT_STATUS.md](PRODUCT_STATUS.md) | Возможности простым языком + roadmap улучшений |

---

## 7. Соглашения, которые должен знать каждый участник

- **Это Next.js 16** — относитесь к нему как к отдельной версии. Перед изменением routing,
  server actions, metadata, middleware, caching или соглашений файлов читайте подходящий guide
  в `node_modules/next/dist/docs/`.
- **Миграции append-only и идемпотентны.** Никогда не правьте применённую миграцию; вместо
  этого добавляйте новую миграцию с guard.
- **Тесты** используют встроенный Node runner с `--experimental-strip-types` (без Jest/Vitest).
  Тестируемые модули `src/lib` должны использовать **относительные** `.ts` import, а не alias
  `@/`. `npm run test` запускает `src/**/*.test.mjs`; `charging-auto-session.test.mjs` исключён
  из glob и запускается явно.
- **При изменении поведения обновляйте соответствующий документ** (см. §6) и добавляйте/правьте
  тесты parser logic, charging completion, trip filtering, telemetry history или push thresholds.
