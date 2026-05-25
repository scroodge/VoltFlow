import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const DEFAULT_VEHICLE_ID = "way";
const CHARGING_SAMPLE_LIMIT = 360;
const AVAILABLE_DATES_SAMPLE_LIMIT = 900;
const CHARGE_WINDOW_GAP_MS = 30 * 60 * 1000;

type LiveRow = {
  vehicle_id: string;
  device_time: string;
  received_at: string;
  telemetry?: Record<string, unknown> | null;
  diplus?: Record<string, unknown> | null;
  diplus_min_cell_voltage_v?: number | null;
  diplus_max_cell_voltage_v?: number | null;
  diplus_cell_delta_v?: number | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  status: string;
  started_at: string | null;
  stopped_at: string | null;
  updated_at: string;
  created_at: string;
  start_percent: number;
  current_percent: number;
  target_percent: number;
  battery_capacity_kwh: number;
  efficiency_percent: number;
  price_per_kwh: number;
  charged_energy_kwh: number;
  estimated_cost: number;
  charger_power_kw: number;
};

type SampleRow = {
  device_time: string;
  telemetry?: Record<string, unknown> | null;
  diplus?: Record<string, unknown> | null;
  diplus_min_cell_voltage_v?: number | null;
  diplus_max_cell_voltage_v?: number | null;
  diplus_cell_delta_v?: number | null;
};

type DeltaPoint = {
  soc: number;
  delta: number;
  minCellVoltage: number | null;
  maxCellVoltage: number | null;
  time: string;
};

export default async function DevChargingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const vehicleId = readParam(params.vehicle_id) ?? DEFAULT_VEHICLE_ID;
  const requestedDate = readParam(params.date);
  const requestedWindowIndex = Number(readParam(params.window) ?? "0");
  const supabase = createServiceClient();

  const { data: liveRows, error: liveError } = await supabase
    .from("bydmate_live_snapshots")
    .select("vehicle_id, device_time, received_at, telemetry, diplus, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v")
    .eq("vehicle_id", vehicleId)
    .order("received_at", { ascending: false })
    .limit(1);

  const live = ((liveRows ?? []) as LiveRow[])[0] ?? null;

  const { data: activeRows, error: activeError } = await supabase
    .from("charging_sessions")
    .select("id, user_id, status, started_at, stopped_at, updated_at, created_at, start_percent, current_percent, target_percent, battery_capacity_kwh, efficiency_percent, price_per_kwh, charged_energy_kwh, estimated_cost, charger_power_kw")
    .eq("status", "charging")
    .order("created_at", { ascending: false })
    .limit(3);

  const { data: availableRows } = await supabase
    .from("bydmate_telemetry_samples")
    .select("device_time")
    .eq("vehicle_id", vehicleId)
    .eq("telemetry->>is_charging", "true")
    .order("device_time", { ascending: false })
    .limit(AVAILABLE_DATES_SAMPLE_LIMIT);
  const availableDates = Array.from(
    new Set(((availableRows ?? []) as Array<{ device_time: string }>).map((row) => minskDateKey(row.device_time))),
  );
  const selectedDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : availableDates[0] ?? minskDateKey(new Date().toISOString());
  const selectedWindow = minskDayWindow(selectedDate);

  const { data: chargingRows, error: chargingError } = await supabase
    .from("bydmate_telemetry_samples")
    .select("device_time, telemetry, diplus, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v")
    .eq("vehicle_id", vehicleId)
    .eq("telemetry->>is_charging", "true")
    .gte("device_time", selectedWindow.from)
    .lt("device_time", selectedWindow.to)
    .order("device_time", { ascending: true })
    .limit(CHARGING_SAMPLE_LIMIT);
  const { data: fallbackChargingRows } = await supabase
    .from("bydmate_telemetry_samples")
    .select("device_time, telemetry, diplus, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v")
    .eq("vehicle_id", vehicleId)
    .eq("telemetry->>is_charging", "true")
    .order("device_time", { ascending: false })
    .limit(CHARGING_SAMPLE_LIMIT);

  const activeSessions = (activeRows ?? []) as SessionRow[];
  const chargeWindows = groupChargeWindows(
    (chargingRows ?? []) as SampleRow[],
  );
  const latestChargeWindows = groupChargeWindows(
    [...((fallbackChargingRows ?? []) as SampleRow[])].reverse(),
  ).reverse();
  const selectedChargeWindowIndex = Number.isFinite(requestedWindowIndex)
    ? Math.max(0, Math.min(Math.max(0, chargeWindows.length - 1), requestedWindowIndex))
    : 0;
  const selectedChargeWindow = chargeWindows[selectedChargeWindowIndex] ?? null;
  const activeSessionsWithPoints = await Promise.all(
    activeSessions.map(async (session) => ({
      session,
      points: await fetchSessionDeltaPoints(supabase, session, vehicleId),
    })),
  );
  const liveDelta = live ? sampleDelta(live) : null;
  const liveSoc = live ? sampleSoc(live) : null;
  const liveIsCharging = live ? isChargingSample(live) : false;
  const liveChargePower = live ? numberValue(live.telemetry?.charge_power_kw) ?? numberValue(live.telemetry?.power_kw) : null;

  return (
    <main className="safe-bottom mx-auto flex max-w-6xl flex-col gap-5 px-4 pb-8 pt-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-[0.24em]">
            Dev / Charging
          </p>
          <h1 className="mt-2 font-heading text-3xl font-bold tracking-normal">
            Charging with BYDMate delta
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Online charging and saved charge windows for{" "}
            <span className="font-mono text-foreground">{vehicleId}</span>. Delta charts are
            drawn left to right from 0% SOC to 100% SOC.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/dev/history?vehicle_id=${vehicleId}`}>Dev history</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/dev/vehicle?vehicle_id=${vehicleId}`}>Dev vehicle</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/dev/bydmate-diplus?vehicle_id=${vehicleId}`}>Di+ debug</Link>
          </Button>
        </div>
      </header>

      {(liveError || activeError || chargingError) ? (
        <section className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          {liveError ? <p>Live query: {liveError.message}</p> : null}
          {activeError ? <p>Active sessions query: {activeError.message}</p> : null}
          {chargingError ? <p>Charging samples query: {chargingError.message}</p> : null}
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Online BYDMate charging</CardTitle>
            <CardDescription>
              Latest live snapshot from {live ? formatDate(live.received_at) : "none"}.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className={`rounded-2xl border p-4 ${liveIsCharging ? "border-primary/30 bg-primary/10" : "border-yellow-300/20 bg-yellow-300/[0.06]"}`}>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Status</p>
              <p className="mt-2 font-heading text-2xl font-semibold">
                {liveIsCharging ? "Charging" : "Not charging / stale"}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <Metric label="SOC" value={`${fmt(liveSoc)}%`} />
              <Metric label="Power" value={`${fmt(liveChargePower, 1)} kW`} />
              <Metric label="Delta" value={`${fmt(liveDelta, 3)} V`} />
              <Metric label="Device" value={live ? formatTime(live.device_time) : "—"} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active app sessions</CardTitle>
            <CardDescription>
              These are `/charging/` app sessions; telemetry graphs below come from BYDMate `way`.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {activeSessions.length === 0 ? (
              <p className="rounded-2xl border border-border bg-white/[0.02] p-4 text-sm text-muted-foreground">
                No active app charging session.
              </p>
            ) : (
              activeSessionsWithPoints.map(({ session, points }) => {
                const fallbackPoints = latestChargeWindows[0]?.points ?? [];
                const chartPoints = points.length > 0 ? points : fallbackPoints;
                const chartSource = points.length > 0
                  ? "Current app session window"
                  : "Latest BYDMate charge window";

                return (
                <div key={session.id} className="rounded-2xl border border-border bg-white/[0.02] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-heading text-lg font-semibold">
                        {formatDate(session.started_at ?? session.created_at)}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        SOC {fmt(session.start_percent)}% → {fmt(session.current_percent)}% · target {fmt(session.target_percent)}%
                      </p>
                    </div>
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs uppercase tracking-[0.16em] text-primary">
                      charging
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric label="Energy" value={`${fmt(session.charged_energy_kwh, 2)} kWh`} />
                    <Metric label="Power" value={`${fmt(session.charger_power_kw, 1)} kW`} />
                    <Metric label="Now cost" value={fmt(session.estimated_cost, 2)} />
                    <Metric label="Cost at 100%" value={fmt(sessionFullCost(session), 2)} />
                  </dl>
                  <div className="mt-4">
                    <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      {chartSource}
                    </p>
                    {chartPoints.length > 0 ? (
                      <ChargeDeltaPlot points={chartPoints} compact />
                    ) : (
                      <p className="rounded-2xl border border-border bg-background/30 p-4 text-sm text-muted-foreground">
                        No BYDMate charging delta points available yet.
                      </p>
                    )}
                  </div>
                </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Charge history calendar
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a day, then open a charging window with the graph and SOC/delta details.
          </p>
        </div>

        <Card>
          <CardContent className="grid gap-4 p-4">
            <form action="/dev/charging" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="vehicle_id" value={vehicleId} />
              <label className="grid gap-1 text-sm text-muted-foreground">
                Day
                <input
                  type="date"
                  name="date"
                  defaultValue={selectedDate}
                  className="h-10 rounded-xl border border-border bg-background px-3 text-foreground"
                />
              </label>
              <Button type="submit">Open day</Button>
            </form>
            {availableDates.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {availableDates.slice(0, 14).map((dateKey) => (
                  <Link
                    key={dateKey}
                    href={`/dev/charging?vehicle_id=${vehicleId}&date=${dateKey}`}
                    className={
                      "shrink-0 rounded-full border px-3 py-2 text-sm transition " +
                      (dateKey === selectedDate
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-white/[0.03] text-muted-foreground hover:border-primary/50 hover:text-foreground")
                    }
                  >
                    {formatDayLabel(dateKey)}
                  </Link>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {chargeWindows.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              No BYDMate charging delta samples found for {selectedDate}.
            </CardContent>
          </Card>
        ) : (
          <section className="grid gap-4 lg:grid-cols-[20rem_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>{formatDayLabel(selectedDate)}</CardTitle>
                <CardDescription>{chargeWindows.length} charge windows</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {chargeWindows.map((window, index) => (
                  <Link
                    key={`${window.start}-${index}`}
                    href={`/dev/charging?vehicle_id=${vehicleId}&date=${selectedDate}&window=${index}`}
                    className={
                      "rounded-2xl border p-3 transition " +
                      (index === selectedChargeWindowIndex
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-white/[0.02] text-muted-foreground hover:border-primary/50 hover:text-foreground")
                    }
                  >
                    <span className="block font-heading text-base font-semibold">
                      {formatTime(window.start)} - {formatTime(window.end)}
                    </span>
                    <span className="mt-1 block text-xs">
                      {window.points.length} pts · SOC {fmt(Math.min(...window.points.map((point) => point.soc)))}-
                      {fmt(Math.max(...window.points.map((point) => point.soc)))}%
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{selectedChargeWindow ? formatDate(selectedChargeWindow.start) : selectedDate}</CardTitle>
                    <CardDescription>
                      {selectedChargeWindow ? `${formatTime(selectedChargeWindow.start)} - ${formatTime(selectedChargeWindow.end)}` : "No window selected"}
                    </CardDescription>
                  </div>
                  <span className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {selectedChargeWindow?.points.length ?? 0} pts
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                {selectedChargeWindow ? (
                  <ChargeDeltaPlot points={selectedChargeWindow.points} />
                ) : (
                  <p className="text-sm text-muted-foreground">No charge window selected.</p>
                )}
              </CardContent>
            </Card>
          </section>
        )}
      </section>
    </main>
  );
}

async function fetchSessionDeltaPoints(
  supabase: ReturnType<typeof createServiceClient>,
  session: SessionRow,
  vehicleId: string,
) {
  if (!session.started_at) return [];

  const endAt =
    session.stopped_at ??
    (session.status === "charging" ? new Date().toISOString() : session.updated_at);

  const { data } = await supabase
    .from("bydmate_telemetry_samples")
    .select("device_time, telemetry, diplus, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v")
    .eq("user_id", session.user_id)
    .eq("vehicle_id", vehicleId)
    .gte("device_time", session.started_at)
    .lte("device_time", endAt)
    .order("device_time", { ascending: true })
    .limit(CHARGING_SAMPLE_LIMIT);

  return ((data ?? []) as SampleRow[])
    .filter(isChargingSample)
    .flatMap((sample) => {
      const soc = sampleSoc(sample);
      const delta = sampleDelta(sample);
      return soc != null && delta != null
        ? [{
            soc,
            delta,
            minCellVoltage: sampleMinCellVoltage(sample),
            maxCellVoltage: sampleMaxCellVoltage(sample),
            time: sample.device_time,
          }]
        : [];
    })
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

function groupChargeWindows(samples: SampleRow[]) {
  const windows: Array<{ start: string; end: string; points: DeltaPoint[] }> = [];

  for (const sample of samples) {
    const soc = sampleSoc(sample);
    const delta = sampleDelta(sample);
    const timeMs = Date.parse(sample.device_time);
    if (soc == null || delta == null || !Number.isFinite(timeMs)) continue;

    const previous = windows.at(-1);
    const previousEndMs = previous ? Date.parse(previous.end) : Number.NaN;
    if (!previous || timeMs - previousEndMs > CHARGE_WINDOW_GAP_MS) {
      windows.push({
        start: sample.device_time,
        end: sample.device_time,
        points: [{
          soc,
          delta,
          minCellVoltage: sampleMinCellVoltage(sample),
          maxCellVoltage: sampleMaxCellVoltage(sample),
          time: sample.device_time,
        }],
      });
    } else {
      previous.end = sample.device_time;
      previous.points.push({
        soc,
        delta,
        minCellVoltage: sampleMinCellVoltage(sample),
        maxCellVoltage: sampleMaxCellVoltage(sample),
        time: sample.device_time,
      });
    }
  }

  return windows.map((window) => ({
    ...window,
    points: window.points.sort((a, b) => Date.parse(a.time) - Date.parse(b.time)),
  }));
}

function ChargeDeltaPlot({
  points,
  compact = false,
}: {
  points: DeltaPoint[];
  compact?: boolean;
}) {
  const latest = points.at(-1) ?? null;
  const minSoc = Math.min(...points.map((point) => point.soc));
  const maxSoc = Math.max(...points.map((point) => point.soc));
  const minDelta = Math.min(...points.map((point) => point.delta));
  const maxDelta = Math.max(...points.map((point) => point.delta));
  const minCellVoltages = points
    .map((point) => point.minCellVoltage)
    .filter((value): value is number => value != null);
  const maxCellVoltages = points
    .map((point) => point.maxCellVoltage)
    .filter((value): value is number => value != null);
  const minCellVoltage = minCellVoltages.length ? Math.min(...minCellVoltages) : null;
  const maxCellVoltage = maxCellVoltages.length ? Math.max(...maxCellVoltages) : null;
  const minTime = Math.min(...points.map((point) => Date.parse(point.time)));
  const maxTime = Math.max(...points.map((point) => Date.parse(point.time)));
  const deltaPad = Math.max((maxDelta - minDelta) * 0.14, 0.005);
  const yMin = Math.max(0, minDelta - deltaPad);
  const yMax = maxDelta + deltaPad;
  const x = (time: string) => {
    const timeMs = Date.parse(time);
    if (maxTime === minTime || !Number.isFinite(timeMs)) return 160;
    return 24 + ((timeMs - minTime) / (maxTime - minTime)) * 272;
  };
  const y = (delta: number) => yMax === yMin ? 72 : 110 - ((delta - yMin) / (yMax - yMin)) * 92;
  const socY = (soc: number) => {
    if (maxSoc === minSoc) return 72;
    return 110 - ((soc - minSoc) / (maxSoc - minSoc)) * 92;
  };
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(2)} ${y(point.delta).toFixed(2)}`)
    .join(" ");
  const socPath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(2)} ${socY(point.soc).toFixed(2)}`)
    .join(" ");

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
      <div className="rounded-2xl border border-border bg-background/30 p-3">
        <svg className={`${compact ? "h-44" : "h-60"} w-full overflow-hidden`} viewBox="0 0 320 142" role="img" aria-label="Charging cell delta by SOC">
          <line x1="24" x2="296" y1="110" y2="110" stroke="currentColor" className="text-border" strokeWidth="1" />
          <line x1="24" x2="24" y1="18" y2="110" stroke="currentColor" className="text-border" strokeWidth="1" />
          <line x1="24" x2="296" y1="64" y2="64" stroke="currentColor" className="text-border/70" strokeWidth="1" strokeDasharray="4 6" />
          <text x="24" y="132" className="fill-muted-foreground text-[10px]">{formatTime(points[0]?.time)}</text>
          <text x="296" y="132" textAnchor="end" className="fill-muted-foreground text-[10px]">{formatTime(points.at(-1)?.time)}</text>
          <text x="30" y="14" className="fill-muted-foreground text-[10px]">{fmt(yMax, 3)} V</text>
          <text x="30" y="106" className="fill-muted-foreground text-[10px]">{fmt(yMin, 3)} V</text>
          <text x="296" y="14" textAnchor="end" className="fill-primary text-[10px]">{fmt(maxSoc)}% SOC</text>
          <text x="296" y="106" textAnchor="end" className="fill-primary text-[10px]">{fmt(minSoc)}% SOC</text>
          {points.length > 1 ? (
            <path d={socPath} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.78" strokeDasharray="3 5" />
          ) : null}
          {points.length > 1 ? (
            <path d={path} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.78" />
          ) : null}
          {points.map((point, index) => (
            <circle
              key={`${point.time}-${index}`}
              cx={x(point.time)}
              cy={y(point.delta)}
              r={point === latest ? 4 : 3}
              fill={point === latest ? "#facc15" : "#fb7185"}
              opacity={point === latest ? 1 : 0.78}
            />
          ))}
        </svg>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[#38bdf8]" />
            Delta
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full border-t-2 border-dashed border-[#22c55e]" />
            SOC
          </span>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
        <Metric label="SOC range" value={`${fmt(minSoc)}-${fmt(maxSoc)}%`} />
        <Metric label="Delta range" value={`${fmt(minDelta, 3)}-${fmt(maxDelta, 3)} V`} />
        <Metric label="Latest" value={latest ? `${fmt(latest.soc)}% / ${fmt(latest.delta, 3)} V` : "—"} />
        <Metric label="Latest min cell" value={`${fmt(latest?.minCellVoltage, 3)} V`} />
        <Metric label="Latest max cell" value={`${fmt(latest?.maxCellVoltage, 3)} V`} />
        <Metric label="Cell voltage range" value={`${fmt(minCellVoltage, 3)}-${fmt(maxCellVoltage, 3)} V`} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/30 p-3">
      <dt className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-foreground">{value}</dd>
    </div>
  );
}

function sessionFullCost(session: SessionRow) {
  if (session.price_per_kwh <= 0 || session.efficiency_percent <= 0) return null;
  const batteryEnergyKwh =
    (session.battery_capacity_kwh * Math.max(0, 100 - session.start_percent)) / 100;
  const gridEnergyKwh = batteryEnergyKwh / (session.efficiency_percent / 100);
  return gridEnergyKwh * session.price_per_kwh;
}

function isChargingSample(sample: SampleRow | LiveRow) {
  const telemetry = sample.telemetry ?? {};
  const chargePower = numberValue(telemetry.charge_power_kw) ?? numberValue(telemetry.power_kw);
  return telemetry.is_charging === true || (chargePower != null && chargePower > 0);
}

function sampleSoc(sample: SampleRow | LiveRow) {
  return numberValue(sample.telemetry?.soc) ?? numberValue(sample.diplus?.soc);
}

function sampleDelta(sample: SampleRow | LiveRow) {
  const stored =
    numberValue(sample.diplus_cell_delta_v) ??
    numberValue(sample.telemetry?.diplus_cell_delta_v) ??
    numberValue(sample.telemetry?.cell_delta_v) ??
    numberValue(sample.diplus?.cell_delta_v);
  if (stored != null) return stored;

  const min =
    numberValue(sample.diplus_min_cell_voltage_v) ??
    numberValue(sample.telemetry?.diplus_min_cell_voltage_v) ??
    numberValue(sample.telemetry?.cell_voltage_min_v) ??
    numberValue(sample.diplus?.min_cell_voltage_v);
  const max =
    numberValue(sample.diplus_max_cell_voltage_v) ??
    numberValue(sample.telemetry?.diplus_max_cell_voltage_v) ??
    numberValue(sample.telemetry?.cell_voltage_max_v) ??
    numberValue(sample.diplus?.max_cell_voltage_v);

  return min != null && max != null ? max - min : null;
}

function sampleMinCellVoltage(sample: SampleRow | LiveRow) {
  return numberValue(sample.diplus_min_cell_voltage_v) ??
    numberValue(sample.telemetry?.diplus_min_cell_voltage_v) ??
    numberValue(sample.telemetry?.cell_voltage_min_v) ??
    numberValue(sample.diplus?.min_cell_voltage_v);
}

function sampleMaxCellVoltage(sample: SampleRow | LiveRow) {
  return numberValue(sample.diplus_max_cell_voltage_v) ??
    numberValue(sample.telemetry?.diplus_max_cell_voltage_v) ??
    numberValue(sample.telemetry?.cell_voltage_max_v) ??
    numberValue(sample.diplus?.max_cell_voltage_v);
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fmt(value: number | null | undefined, digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Minsk",
  });
}

function formatDayLabel(value: string) {
  return new Date(`${value}T12:00:00+03:00`).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    timeZone: "Europe/Minsk",
  });
}

function formatTime(value: string | null | undefined) {
  if (!value) return "now";
  return new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Minsk",
  });
}

function minskDateKey(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Minsk",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function minskDayWindow(dateKey: string) {
  const from = new Date(`${dateKey}T00:00:00+03:00`);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}
