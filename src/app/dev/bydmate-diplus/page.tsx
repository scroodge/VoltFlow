import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DEV_WAY_VEHICLE_ID } from "@/lib/dev/way-context";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

type DiplusKey = {
  key: string;
  column?: string;
  label: string;
};

type DiplusRow = {
  id?: string;
  vehicle_id: string;
  device_time: string;
  received_at: string;
  telemetry?: Record<string, unknown> | null;
  diplus?: Record<string, unknown> | null;
  raw_payload?: unknown;
  [key: string]: unknown;
};

type TripWindowRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  last_device_time: string;
  soc_start: number | null;
  soc_end: number | null;
  sample_count: number;
};

/** Dev fixture default only — not used in production charging/history routes. */
const DEFAULT_VEHICLE_ID = DEV_WAY_VEHICLE_ID;
const SAMPLE_LIMIT = 60;
const DELTA_BY_SOC_LIMIT = 60;
const CHARGING_DELTA_LIMIT = 140;

const DIPLUS_KEYS: DiplusKey[] = [
  { key: "soc", column: "diplus_soc", label: "SOC" },
  { key: "speed_kmh", column: "diplus_speed_kmh", label: "Speed" },
  { key: "mileage_km", column: "diplus_mileage_km", label: "Mileage" },
  { key: "power_kw", column: "diplus_power_kw", label: "Power" },
  { key: "charge_gun_state", column: "diplus_charge_gun_state", label: "Charge gun" },
  { key: "charging_status", column: "diplus_charging_status", label: "Charging" },
  { key: "battery_capacity_kwh", column: "diplus_battery_capacity_kwh", label: "Battery capacity" },
  {
    key: "total_elec_consumption_kwh",
    column: "diplus_total_elec_consumption_kwh",
    label: "Total electric consumption",
  },
  { key: "voltage_12v", column: "diplus_voltage_12v", label: "12V" },
  { key: "max_cell_voltage_v", column: "diplus_max_cell_voltage_v", label: "Max cell" },
  { key: "min_cell_voltage_v", column: "diplus_min_cell_voltage_v", label: "Min cell" },
  { key: "cell_delta_v", column: "diplus_cell_delta_v", label: "Cell delta" },
  { key: "max_battery_temp_c", label: "Max battery temp" },
  { key: "avg_battery_temp_c", column: "diplus_avg_battery_temp_c", label: "Avg battery temp" },
  { key: "min_battery_temp_c", label: "Min battery temp" },
  { key: "exterior_temp_c", column: "diplus_exterior_temp_c", label: "Exterior temp" },
  { key: "gear", column: "diplus_gear", label: "Gear" },
  { key: "power_state", column: "diplus_power_state", label: "Power state" },
  { key: "inside_temp_c", column: "diplus_inside_temp_c", label: "Inside temp" },
  { key: "ac_status", column: "diplus_ac_status", label: "AC status" },
  { key: "ac_temp_c", column: "diplus_ac_temp_c", label: "AC temp" },
  { key: "fan_level", column: "diplus_fan_level", label: "Fan level" },
  { key: "ac_circ", label: "AC circulation" },
  { key: "door_fl", column: "diplus_door_fl", label: "Door FL" },
  { key: "door_fr", column: "diplus_door_fr", label: "Door FR" },
  { key: "door_rl", column: "diplus_door_rl", label: "Door RL" },
  { key: "door_rr", column: "diplus_door_rr", label: "Door RR" },
  { key: "window_fl_percent", column: "diplus_window_fl_percent", label: "Window FL" },
  { key: "window_fr_percent", column: "diplus_window_fr_percent", label: "Window FR" },
  { key: "window_rl_percent", column: "diplus_window_rl_percent", label: "Window RL" },
  { key: "window_rr_percent", column: "diplus_window_rr_percent", label: "Window RR" },
  { key: "sunroof_percent", column: "diplus_sunroof_percent", label: "Sunroof" },
  { key: "trunk", column: "diplus_trunk", label: "Trunk" },
  { key: "hood", column: "diplus_hood", label: "Hood" },
  { key: "seatbelt_fl", label: "Seatbelt FL" },
  { key: "lock_fl", label: "Lock FL" },
  { key: "tire_press_fl_kpa", column: "diplus_tire_press_fl_kpa", label: "Tire FL" },
  { key: "tire_press_fr_kpa", column: "diplus_tire_press_fr_kpa", label: "Tire FR" },
  { key: "tire_press_rl_kpa", column: "diplus_tire_press_rl_kpa", label: "Tire RL" },
  { key: "tire_press_rr_kpa", column: "diplus_tire_press_rr_kpa", label: "Tire RR" },
  { key: "drive_mode", column: "diplus_drive_mode", label: "Drive mode" },
  { key: "work_mode", column: "diplus_work_mode", label: "Work mode" },
  { key: "auto_park", column: "diplus_auto_park", label: "Auto park" },
  { key: "rain", column: "diplus_rain", label: "Rain" },
  { key: "light_low", column: "diplus_light_low", label: "Low beam" },
  { key: "drl", column: "diplus_drl", label: "DRL" },
];

const DIPLUS_COLUMNS = DIPLUS_KEYS.map((item) => item.column).filter(Boolean).join(", ");

function fmt(value: number | null | undefined, digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export default async function BydmateDiplusDebugPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const vehicleId = readParam(params.vehicle_id) ?? DEFAULT_VEHICLE_ID;
  const supabase = createServiceClient();

  const liveQuery = await supabase
    .from("bydmate_live_snapshots")
    .select(
      `id, vehicle_id, device_time, received_at, telemetry, diplus, raw_payload, ${DIPLUS_COLUMNS}`,
    )
    .eq("vehicle_id", vehicleId)
    .order("received_at", { ascending: false })
    .limit(1);

  const samplesQuery = await supabase
    .from("bydmate_telemetry_samples")
    .select(`id, vehicle_id, device_time, received_at, telemetry, `)
    .eq("vehicle_id", vehicleId)
    .order("device_time", { ascending: false })
    .limit(SAMPLE_LIMIT);
  const latestTripQuery = await supabase
    .from("bydmate_trips")
    .select("id, started_at, ended_at, last_device_time, soc_start, soc_end, sample_count")
    .eq("vehicle_id", vehicleId)
    .order("started_at", { ascending: false })
    .limit(1);
  const latestTrip = ((latestTripQuery.data ?? []) as TripWindowRow[])[0] ?? null;
  const tripEndAt = latestTrip ? latestTrip.ended_at ?? latestTrip.last_device_time : null;
  const tripSamplesQuery = latestTrip && tripEndAt
    ? await supabase
      .from("bydmate_telemetry_samples")
      .select(`id, vehicle_id, device_time, received_at, telemetry, `)
      .eq("vehicle_id", vehicleId)
      .gte("device_time", latestTrip.started_at)
      .lte("device_time", tripEndAt)
      .order("device_time", { ascending: true })
      .limit(DELTA_BY_SOC_LIMIT)
    : { data: [], error: null };
  const chargingSamplesQuery = await supabase
    .from("bydmate_telemetry_samples")
    .select(`id, vehicle_id, device_time, received_at, telemetry, `)
    .eq("vehicle_id", vehicleId)
    .eq("telemetry->>is_charging", "true")
    .order("device_time", { ascending: false })
    .limit(CHARGING_DELTA_LIMIT);

  const live = ((liveQuery.data ?? []) as unknown as DiplusRow[])[0] ?? null;
  const samples = (samplesQuery.data ?? []) as unknown as DiplusRow[];
  const tripSamples = (tripSamplesQuery.data ?? []) as unknown as DiplusRow[];
  const chargingSamples = [...((chargingSamplesQuery.data ?? []) as unknown as DiplusRow[])].reverse();
  const latestWithRawDiplus = samples.find((row) => Object.keys(row.diplus ?? {}).length > 0) ?? null;
  const latestWithCellDelta =
    samples.find((row) => cellDeltaValue(row) != null) ??
    null;
  const deltaBySoc = prepareDeltaBySoc(samples, "charge");
  const tripDeltaBySoc = prepareDeltaBySoc(tripSamples, "discharge");
  const chargingDeltaBySoc = prepareDeltaBySoc(chargingSamples, "charge");

  return (
    <main className="safe-bottom mx-auto flex max-w-7xl flex-col gap-5 px-4 pb-8 pt-5">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs uppercase tracking-[0.22em]">
          Dev / VoltFlow Mate Di+
        </p>
        <h1 className="font-heading text-3xl font-bold tracking-normal">
          Di+ payload debug
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Vehicle <span className="font-mono text-foreground">{vehicleId}</span>. Shows the
          latest live snapshot, the last {SAMPLE_LIMIT} samples, normalized Di+ columns, and
          raw Di+ objects received by Supabase.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Latest live" value={live ? formatDate(live.received_at) : "none"} />
        <MetricCard label="Samples checked" value={samples.length.toString()} />
        <MetricCard label="Latest raw Di+" value={latestWithRawDiplus ? formatDate(latestWithRawDiplus.received_at) : "none"} />
        <MetricCard label="Latest cell delta" value={latestWithCellDelta ? formatCellDelta(latestWithCellDelta) : "none"} />
      </section>

      {(liveQuery.error || samplesQuery.error) && (
        <Card className="border-destructive/40 bg-destructive/10">
          <CardHeader>
            <CardTitle>Query errors</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 font-mono text-xs">
            {liveQuery.error && <p>live: {liveQuery.error.message}</p>}
            {samplesQuery.error && <p>samples: {samplesQuery.error.message}</p>}
          </CardContent>
        </Card>
      )}

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Latest trip delta by SOC</CardTitle>
            <CardDescription>
              Vehicle <span className="font-mono">{vehicleId}</span>. Left to right is
              discharge: 100% SOC to 0% SOC.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeltaBySocChart chart={tripDeltaBySoc} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Charging delta history</CardTitle>
            <CardDescription>
              Vehicle <span className="font-mono">{vehicleId}</span>. Charging samples are drawn
              left to right from 0% SOC to 100% SOC.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeltaBySocChart chart={chargingDeltaBySoc} />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Cell delta by SOC</CardTitle>
          <CardDescription>
            Last {Math.min(samples.length, DELTA_BY_SOC_LIMIT)} samples for{" "}
            <span className="font-mono">{vehicleId}</span>. X is SOC, Y is cell voltage delta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeltaBySocChart chart={deltaBySoc} />
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader>
            <CardTitle>Latest live snapshot</CardTitle>
            <CardDescription>
              Device {live ? formatDate(live.device_time) : "none"} · received{" "}
              {live ? formatDate(live.received_at) : "none"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {live ? <DiplusFieldTable row={live} /> : <EmptyState />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Raw payload</CardTitle>
            <CardDescription>Live snapshot payload as stored by ingest.</CardDescription>
          </CardHeader>
          <CardContent>
            <JsonBlock value={live?.raw_payload ?? null} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader>
            <CardTitle>Recent samples</CardTitle>
            <CardDescription>Newest samples first. A dot means the row has raw Di+ keys.</CardDescription>
          </CardHeader>
          <CardContent>
            <SamplesTable rows={samples} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Latest sample Di+</CardTitle>
            <CardDescription>Raw Di+ object from the newest sample that contains any Di+ key.</CardDescription>
          </CardHeader>
          <CardContent>
            <JsonBlock value={latestWithRawDiplus?.diplus ?? {}} />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-muted-foreground text-xs uppercase tracking-[0.18em]">{label}</p>
        <p className="mt-2 break-words font-heading text-lg font-semibold tracking-normal">{value}</p>
      </CardContent>
    </Card>
  );
}

function DiplusFieldTable({ row }: { row: DiplusRow }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b text-xs uppercase tracking-[0.16em] text-muted-foreground">
          <tr>
            <th className="py-2 pr-3 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">Raw Di+</th>
            <th className="px-3 py-2 font-medium">DB column</th>
            <th className="py-2 pl-3 font-medium">Column name</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {DIPLUS_KEYS.map((field) => (
            <tr key={field.key}>
              <td className="py-2 pr-3">
                <span className="font-medium">{field.label}</span>
                <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{field.key}</span>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{formatValue(valueFor(row, field.key))}</td>
              <td className="px-3 py-2 font-mono text-xs">
                {field.column ? formatValue(valueFor(row, field.column)) : "no column"}
              </td>
              <td className="py-2 pl-3 font-mono text-xs text-muted-foreground">{field.column ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SamplesTable({ rows }: { rows: DiplusRow[] }) {
  if (rows.length === 0) return <EmptyState />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-left text-sm">
        <thead className="border-b text-xs uppercase tracking-[0.16em] text-muted-foreground">
          <tr>
            <th className="py-2 pr-3 font-medium">Di+</th>
            <th className="px-3 py-2 font-medium">Device time</th>
            <th className="px-3 py-2 font-medium">Received</th>
            <th className="px-3 py-2 font-medium">SOC</th>
            <th className="px-3 py-2 font-medium">Min</th>
            <th className="px-3 py-2 font-medium">Max</th>
            <th className="py-2 pl-3 font-medium">Delta</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const hasRawDiplus = Object.keys(row.diplus ?? {}).length > 0;
            const soc = socValue(row);
            const cellDelta = cellDeltaValue(row);
            return (
              <tr key={row.id ?? `${row.device_time}-${row.received_at}`}>
                <td className="py-2 pr-3">
                  <span
                    className={`inline-block size-2 rounded-full ${
                      hasRawDiplus ? "bg-emerald-400" : "bg-muted-foreground/30"
                    }`}
                    aria-label={hasRawDiplus ? "Has raw Di+ payload" : "No raw Di+ payload"}
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs">{formatDate(row.device_time)}</td>
                <td className="px-3 py-2 font-mono text-xs">{formatDate(row.received_at)}</td>
                <td className="px-3 py-2 font-mono text-xs">{formatValue(soc)}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {formatValue(valueFor(row, "diplus_min_cell_voltage_v"))}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {formatValue(valueFor(row, "diplus_max_cell_voltage_v"))}
                </td>
                <td className="py-2 pl-3 font-mono text-xs">
                  {formatValue(cellDelta)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type DeltaBySocPoint = {
  soc: number;
  delta: number;
  deviceTime: string;
};

type DeltaBySocChartModel = {
  points: DeltaBySocPoint[];
  minSoc: number;
  maxSoc: number;
  minDelta: number;
  maxDelta: number;
  latest: DeltaBySocPoint | null;
  direction: "charge" | "discharge";
};

function DeltaBySocChart({ chart }: { chart: DeltaBySocChartModel }) {
  const { points, latest } = chart;

  if (points.length === 0) {
    return <EmptyState />;
  }

  const leftSoc = chart.direction === "discharge" ? 100 : 0;
  const rightSoc = chart.direction === "discharge" ? 0 : 100;
  const deltaPad = Math.max((chart.maxDelta - chart.minDelta) * 0.14, 0.005);
  const yMin = Math.max(0, chart.minDelta - deltaPad);
  const yMax = chart.maxDelta + deltaPad;

  const x = (soc: number) => {
    if (rightSoc === leftSoc) return 160;
    return 24 + ((soc - leftSoc) / (rightSoc - leftSoc)) * 272;
  };
  const y = (delta: number) => {
    if (yMax === yMin) return 72;
    return 110 - ((delta - yMin) / (yMax - yMin)) * 92;
  };
  const chartPoints = [...points].sort((a, b) =>
    chart.direction === "discharge" ? b.soc - a.soc : a.soc - b.soc,
  );
  const path = chartPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.soc).toFixed(2)} ${y(point.delta).toFixed(2)}`)
    .join(" ");

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="rounded-lg border bg-muted/20 p-3">
        <svg className="h-72 w-full overflow-visible" viewBox="0 0 320 142" role="img" aria-label="Cell delta by SOC chart">
          <line x1="24" x2="296" y1="110" y2="110" stroke="currentColor" className="text-border" strokeWidth="1" />
          <line x1="24" x2="24" y1="18" y2="110" stroke="currentColor" className="text-border" strokeWidth="1" />
          <line x1="24" x2="296" y1="64" y2="64" stroke="currentColor" className="text-border/70" strokeWidth="1" strokeDasharray="4 6" />
          <text x="24" y="132" className="fill-muted-foreground text-[10px]">
            {leftSoc}% SOC
          </text>
          <text x="296" y="132" textAnchor="end" className="fill-muted-foreground text-[10px]">
            {rightSoc}% SOC
          </text>
          <text x="30" y="14" className="fill-muted-foreground text-[10px]">
            {formatVoltage(yMax)}
          </text>
          <text x="30" y="106" className="fill-muted-foreground text-[10px]">
            {formatVoltage(yMin)}
          </text>
          {chartPoints.length > 1 ? (
            <path d={path} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.65" />
          ) : null}
          {chartPoints.map((point, index) => {
            const isLatest = point === latest;
            return (
              <circle
                key={`${point.deviceTime}-${index}`}
                cx={x(point.soc)}
                cy={y(point.delta)}
                r={isLatest ? 4.5 : 3}
                fill={isLatest ? "#facc15" : "#fb7185"}
                opacity={isLatest ? 1 : 0.76}
              />
            );
          })}
        </svg>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <DeltaBySocStat label="Points" value={points.length.toString()} />
        <DeltaBySocStat label="SOC range" value={`${fmt(chart.minSoc, 0)}-${fmt(chart.maxSoc, 0)}%`} />
        <DeltaBySocStat label="Delta range" value={`${formatVoltage(chart.minDelta)}-${formatVoltage(chart.maxDelta)}`} />
        <DeltaBySocStat
          label="Latest point"
          value={latest ? `${fmt(latest.soc, 0)}% / ${formatVoltage(latest.delta)}` : "none"}
        />
      </div>
    </div>
  );
}

function DeltaBySocStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-muted-foreground text-xs uppercase tracking-[0.16em]">{label}</p>
      <p className="mt-2 font-mono text-sm text-foreground">{value}</p>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[560px] overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-5">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function EmptyState() {
  return <p className="text-sm text-muted-foreground">No rows found.</p>;
}

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

function valueFor(row: DiplusRow, key: string) {
  if (key.startsWith("diplus_")) return row[key];
  return row.diplus?.[key];
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function socValue(row: DiplusRow) {
  return numberValue(valueFor(row, "diplus_soc")) ?? numberValue(row.telemetry?.soc) ?? numberValue(valueFor(row, "soc"));
}

function cellDeltaValue(row: DiplusRow) {
  const stored = numberValue(valueFor(row, "diplus_cell_delta_v")) ?? numberValue(row.telemetry?.diplus_cell_delta_v) ??
    numberValue(row.telemetry?.cell_delta_v) ?? numberValue(valueFor(row, "cell_delta_v"));
  if (stored != null) return stored;

  const min = numberValue(valueFor(row, "diplus_min_cell_voltage_v")) ??
    numberValue(row.telemetry?.diplus_min_cell_voltage_v) ??
    numberValue(row.telemetry?.cell_voltage_min_v) ??
    numberValue(valueFor(row, "min_cell_voltage_v"));
  const max = numberValue(valueFor(row, "diplus_max_cell_voltage_v")) ??
    numberValue(row.telemetry?.diplus_max_cell_voltage_v) ??
    numberValue(row.telemetry?.cell_voltage_max_v) ??
    numberValue(valueFor(row, "max_cell_voltage_v"));

  return min != null && max != null ? max - min : null;
}

function prepareDeltaBySoc(rows: DiplusRow[], direction: DeltaBySocChartModel["direction"]): DeltaBySocChartModel {
  const points = rows.slice(0, DELTA_BY_SOC_LIMIT).flatMap((row) => {
    const soc = socValue(row);
    const delta = cellDeltaValue(row);
    return soc != null && delta != null ? [{ soc, delta, deviceTime: row.device_time }] : [];
  });

  return {
    points,
    minSoc: points.length ? Math.min(...points.map((point) => point.soc)) : 0,
    maxSoc: points.length ? Math.max(...points.map((point) => point.soc)) : 100,
    minDelta: points.length ? Math.min(...points.map((point) => point.delta)) : 0,
    maxDelta: points.length ? Math.max(...points.map((point) => point.delta)) : 1,
    latest: points[0] ?? null,
    direction,
  };
}

function formatCellDelta(row: DiplusRow) {
  return `${formatValue(cellDeltaValue(row))} V`;
}

function formatVoltage(value: number) {
  return `${fmt(value, 3)} V`;
}

function formatValue(value: unknown) {
  if (value == null) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? value.toString() : value.toFixed(4);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Minsk",
  });
}
