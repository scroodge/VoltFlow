import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const DEFAULT_VEHICLE_ID = "way";
const SESSION_LIMIT = 12;
const SAMPLE_LIMIT = 240;
const CHARGING_SAMPLE_LIMIT = 320;
const CHARGE_WINDOW_GAP_MS = 30 * 60 * 1000;

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
  charged_energy_kwh: number;
  estimated_cost: number;
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
  time: string;
};

export default async function DevHistoryPage({
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

  const { data: sessionRows, error: sessionsError } = await supabase
    .from("charging_sessions")
    .select("id, user_id, status, started_at, stopped_at, updated_at, created_at, start_percent, current_percent, target_percent, charged_energy_kwh, estimated_cost")
    .not("started_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(SESSION_LIMIT);
  const { data: chargingRows, error: chargingError } = await supabase
    .from("bydmate_telemetry_samples")
    .select("device_time, telemetry, diplus, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v")
    .eq("vehicle_id", vehicleId)
    .eq("telemetry->>is_charging", "true")
    .order("device_time", { ascending: false })
    .limit(CHARGING_SAMPLE_LIMIT);

  const sessions = (sessionRows ?? []) as SessionRow[];
  const chargeWindows = groupChargeWindows(
    [...((chargingRows ?? []) as SampleRow[])].reverse(),
  ).reverse();
  const sessionsWithPoints = await Promise.all(
    sessions.map(async (session) => {
      const points = await fetchSessionDeltaPoints(supabase, session, vehicleId);
      return { session, points };
    }),
  );

  return (
    <main className="safe-bottom mx-auto flex max-w-6xl flex-col gap-5 px-4 pb-8 pt-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-[0.24em]">
            Dev / Charging history
          </p>
          <h1 className="mt-2 font-heading text-3xl font-bold tracking-normal">
            Charging delta history
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Real charging sessions paired with <span className="font-mono text-foreground">{vehicleId}</span>{" "}
            charging telemetry. Charts are drawn left to right from 0% SOC to 100% SOC.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/dev/vehicle?vehicle_id=${vehicleId}`}>Dev vehicle</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/dev/bydmate-diplus?vehicle_id=${vehicleId}`}>Di+ debug</Link>
          </Button>
        </div>
      </header>

      {sessionsError ? (
        <section className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          Sessions query: {sessionsError.message}
        </section>
      ) : null}
      {chargingError ? (
        <section className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          Charging samples query: {chargingError.message}
        </section>
      ) : null}

      <section className="grid gap-4">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Telemetry charge windows
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Direct BYDMate charging samples for <span className="font-mono">{vehicleId}</span>.
            This is the clearest view of the stored 0% SOC to 100% SOC delta history.
          </p>
        </div>
        {chargeWindows.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              No BYDMate charging delta samples found.
            </CardContent>
          </Card>
        ) : (
          chargeWindows.slice(0, 6).map((window, index) => (
            <Card key={`${window.start}-${index}`}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{formatDate(window.start)}</CardTitle>
                    <CardDescription>
                      {formatTime(window.start)} - {formatTime(window.end)}
                    </CardDescription>
                  </div>
                  <span className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {window.points.length} pts
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <ChargeDeltaPlot points={window.points} />
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <section className="grid gap-4">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            App charging sessions
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Stored app sessions with any matching BYDMate charging points in their time window.
          </p>
        </div>
        {sessionsWithPoints.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              No charging sessions found.
            </CardContent>
          </Card>
        ) : (
          sessionsWithPoints.map(({ session, points }) => (
            <Card key={session.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>
                      {formatDate(session.started_at ?? session.created_at)}
                    </CardTitle>
                    <CardDescription>
                      {session.status} · SOC {fmt(session.start_percent)}% → {fmt(session.current_percent)}%
                      {" · "}target {fmt(session.target_percent)}%
                    </CardDescription>
                  </div>
                  <span className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {points.length} pts
                  </span>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <ChargeDeltaPlot points={points} />
                <dl className="grid gap-2 sm:grid-cols-3">
                  <Metric label="Energy" value={`${fmt(session.charged_energy_kwh, 2)} kWh`} />
                  <Metric label="Cost" value={fmt(session.estimated_cost, 2)} />
                  <Metric
                    label="Window"
                    value={`${formatTime(session.started_at)} - ${formatTime(session.stopped_at ?? session.updated_at)}`}
                  />
                </dl>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </main>
  );
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
        points: [{ soc, delta, time: sample.device_time }],
      });
    } else {
      previous.end = sample.device_time;
      previous.points.push({ soc, delta, time: sample.device_time });
    }
  }

  return windows.map((window) => ({
    ...window,
    points: window.points.sort((a, b) => a.soc - b.soc || Date.parse(a.time) - Date.parse(b.time)),
  }));
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
    .limit(SAMPLE_LIMIT);

  return ((data ?? []) as SampleRow[])
    .filter(isChargingSample)
    .flatMap((sample) => {
      const soc = sampleSoc(sample);
      const delta = sampleDelta(sample);
      return soc != null && delta != null ? [{ soc, delta, time: sample.device_time }] : [];
    })
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

function ChargeDeltaPlot({ points }: { points: DeltaPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-white/[0.02] p-4 text-sm text-muted-foreground">
        No charging delta points in this session window.
      </div>
    );
  }

  const latest = points.at(-1) ?? null;
  const minSoc = Math.min(...points.map((point) => point.soc));
  const maxSoc = Math.max(...points.map((point) => point.soc));
  const minDelta = Math.min(...points.map((point) => point.delta));
  const maxDelta = Math.max(...points.map((point) => point.delta));
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
  const socY = (soc: number) => maxSoc === minSoc ? 72 : 110 - ((soc - minSoc) / (maxSoc - minSoc)) * 92;
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(2)} ${y(point.delta).toFixed(2)}`)
    .join(" ");
  const socPath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(2)} ${socY(point.soc).toFixed(2)}`)
    .join(" ");

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
      <div className="rounded-2xl border border-border bg-background/30 p-3">
        <svg className="h-60 w-full overflow-hidden" viewBox="0 0 320 142" role="img" aria-label="Charging cell delta by SOC">
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

function isChargingSample(sample: SampleRow) {
  const telemetry = sample.telemetry ?? {};
  const chargePower = numberValue(telemetry.charge_power_kw) ?? numberValue(telemetry.power_kw);
  return telemetry.is_charging === true || (chargePower != null && chargePower > 0);
}

function sampleSoc(sample: SampleRow) {
  return numberValue(sample.telemetry?.soc) ?? numberValue(sample.diplus?.soc);
}

function sampleDelta(sample: SampleRow) {
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

function formatTime(value: string | null | undefined) {
  if (!value) return "now";
  return new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Minsk",
  });
}

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}
