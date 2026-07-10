# ТЗ: оптимизация графиков `/vehicle` + History (единый движок)

Статус: **спецификация, код не трогаем**. Документ ведёт работу по фазам.

Цель — привести графики к практике передовых EV-приложений (Tesla / ABRP / TeslaFi /
Recurrent): чистый базовый набор для всех, свёрнутая диагностика, **один движок** для линий и
столбцов, **личные (per-user) пресеты** и единый период-селектор.

---

## 0. Карта текущего состояния

### `/vehicle` (trip detail → `TripDetailPanel` → `TelemetryHistoryCharts`, `chartMode="trip"`)
Линии в порядке отрисовки: **SOC**, **Speed+Power**, **Regen (bar)**, **Temperatures**,
**Cell Delta**, **Delta-by-SOC** + **RouteMap**.

### History (`HistoryView`) — 3 подвкладки
- **Charging** — календарь + day-summary + карточки сессий (списки-статы, без графиков).
- **Trips** — календарь + карточки поездок + раскрываемый `TripDetailPanel` (= те же trip-линии).
- **Analytics** (`VehicleAnalyticsPanels`):
  - History range (day…year) → **day**: line-charts + `DayInsightCards`; **week+**: 7 bar-графиков
    (`buildBarCharts`): SOC-band, Regen, Speed-max, Power-avg, Temperatures, Mileage, Efficiency.
  - **SoH** — одно число (последний %), хотя `useBydmateSohHistoryQuery` уже грузит историю.
  - **Monthly** — отдельный month-picker + 6 плиток.
  - **Phantom drain** — bar (саморазряд %/день).
  - **Consumption vs Temp** — bar (расход по корзинам уличной t°).
  - **Route insights**, **Lifetime map**, **Export (CSV/JSON)**.

### Ключевой факт
`TelemetryChart` (линии, `createChart`/`addChartPoint`/`finalizeChart` в `vehicle-live-view.tsx`)
и `BarChartModel`/`buildBarCharts` (`telemetry-analytics-charts.tsx`) — **уже generic, data-driven**.
Личные пресеты ложатся на оба движка без переписывания рендера.

---

## 1. Вердикт по графикам

### Trip-линии (`/vehicle` + History→Trips)
| График | Решение |
|---|---|
| SOC | ✅ База. Ось X → **дистанция** (тумблер время/дистанция). |
| Speed+Power | ✅ База, переделать → **Power / Wh·km⁻¹ vs дистанция**; скорость уходит в сводку. |
| Regen (bar) | ⚠️ → одна цифра в сводке (kWh + % от затрат). |
| Temperatures | ⚠️ В свёрнутую «Диагностику». |
| Cell Delta | ❌ Из trip-view убрать → раздел здоровья АКБ. Строить только при наличии per-cell. |
| Delta-by-SOC | ❌ Из trip-view убрать → диагностика. |
| RouteMap | ✅ База. |

### Analytics bar-графики (week+)
| График | Решение |
|---|---|
| Efficiency (kWh/100) + период-среднее | ✅ **Фичеринг** (главный). |
| Mileage (km) | ✅ База. |
| Regen (kWh) | ✅ Оставить. |
| Temperatures (outside) | ⚠️ Только уличная; t° батареи убрать из агрегата. |
| SOC band | ❌ Убрать (неактуарно). |
| Speed max | ❌ Убрать (фан-факт). |
| Power avg | ❌ Убрать (усредняется к шуму). |
| Phantom drain | ✅ Оставить (дифференциатор). |
| Consumption vs Temp | ✅ Оставить. |
| Route insights / Lifetime map | ✅ Оставить. |

---

## 2. Целевая архитектура

### 2.1 Единый период-селектор (Analytics)
Сейчас 3 независимых пикера (главный range + Monthly month-picker + Cost-per-km from/to).
→ **Один глобальный период** управляет всем. «Monthly» и «Cost per km» схлопываются в плитки
общей сводки за выбранный период (cost, €/км — туда же).

Переключатели Day / Week / Month / Quarter / Year всегда начинают период от **сегодняшней
локальной календарной даты**. Для просмотра прошлого периода используются отдельные
day/week/month/quarter/year-пикеры: нормализованный конец месяца или понедельник недели не
должен переноситься в следующее переключение диапазона.

### 2.2 Дескриптор графика (общий для линий и столбцов)
```ts
type ChartTier = "base" | "diagnostic";
type ChartKind = "line" | "bar";
type ChartXAxis = "time" | "distance" | "bucket";

type SeriesField =
  | "soc" | "speed_kmh" | "power_kw" | "consumption_kwh_100km"
  | "battery_temp_c" | "outside_temp_c" | "cabin_temp_c"
  | "cell_delta" | "regen_kwh" | "soh_percent";        // строгий allowlist

type ChartDescriptor = {
  id: string;
  kind: ChartKind;
  xAxis: ChartXAxis;
  tier: ChartTier;
  title: string;
  series: { field: SeriesField; label: string; color: string; unit?: string; digits?: number }[];
};
```
- `prepareTelemetryHistory` и `buildBarCharts` рефакторятся так, чтобы строить из массива
  `ChartDescriptor` (built-in пресеты = неудаляемые дескрипторы).
- Рендер фильтрует по `tier`: `base` всегда, `diagnostic` — в свёрнутом блоке.

### 2.3 Личные пресеты (per-user)
- Хранение: `profiles.chart_presets jsonb default '[]'` (RLS на `profiles` уже по `user_id`,
  отдельная таблица не нужна — пресеты приватные).
- Элемент = `ChartDescriptor` (поля только из allowlist).
- CRUD через server action; UI-билдер «+ график» (выбор полей, оси X, kind, названия).
- Built-in базовые всегда на месте; личные добавляются своим блоком «Мои графики» (после диагностики).

---

## 3. Фазы

### Фаза 1 — Чистка дефолта (быстро, без БД)
**Файлы:** `vehicle-live-view.tsx` (`prepareTelemetryHistory`, `TelemetryHistoryCharts`),
`telemetry-analytics-charts.tsx` (`buildBarCharts`).
- Ввести `tier` на каждый chart; trip-дефолт = SOC + Power + RouteMap, остальное в «Диагностику».
- Cell-delta/Delta-by-SOC — только при наличии per-cell; иначе не строить.
- Убрать bar-графики SOC-band, Speed-max, Power-avg; в Temperatures оставить только outside.
- **Эффект 80%, риск минимальный.**

### Фаза 2 — Базовые улучшения + сводка
**Файлы:** те же + `trip-distance.ts`, тариф из `profiles.default_tariff`.
- Ось X = дистанция для SOC/Power (тумблер).
- Trip-сводка: дистанция, длительность, энергия, эффективность, **стоимость**, регенерация-цифрой.
- Efficiency-бар — в фичеринг (верх Analytics).

### Фаза 3 — SoH-тренд + единый период
**Файлы:** `vehicle-analytics-panels.tsx`, `telemetry-analytics-charts.tsx`.
- **SoH из числа → трендовая линия** SoH % по времени (данные уже есть в `useBydmateSohHistoryQuery`).
- Схлопнуть Monthly + Cost-per-km в общий период-селектор (плитки сводки, включая €/км).
- Распространить `DayInsightCards` (regen-доля, лучшая/худшая поездка, vs baseline) на все периоды.

### Фаза 4 — Charging-over-time
**Новый источник:** агрегаты по `charging_sessions`.
- kWh заряжено по периодам, **AC vs DC**, тренд стоимости, средняя скорость заряда.
- (Опц.) Energy balance: тяга / регенерация / климат / phantom — stacked за период.

### Фаза 5 — Движок личных пресетов
- Миграция `profiles.chart_presets jsonb`; пересобрать Supabase-типы.
- Рефактор обоих движков на `ChartDescriptor`; built-in как дескрипторы.
- Server action CRUD + UI-билдер; блок «Мои графики».

---

## 4. Приоритеты
1. **Фаза 1** (чистка) + **Фаза 3 SoH-тренд** — максимум ценности за минимум риска.
2. **Фаза 2** (trip-сводка со стоимостью).
3. **Фаза 3 единый период** (убрать дубль-пикеры).
4. **Фаза 4** (charging-over-time).
5. **Фаза 5** (личные пресеты) — отдельно, требует БД.

## 5. Сквозные требования
- i18n-ключи (`vehicle.charts.*`, `vehicle.analytics.*`, `vehicle.trips.*`) — во все локали (ru/be/en).
- Не трогать: Charging-список, charging-session-screen, ingest/sync.
- Trip-сводка стоимости использует `profiles.default_tariff` + `currency` из `use-app-preferences`.
- Личные пресеты — строгий allowlist полей, никаких произвольных ключей телеметрии.
- Фазы независимы; 1–4 без миграций, 5 — с миграцией.
