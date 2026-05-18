"use client";

import {
  Activity,
  BatteryCharging,
  CarFront,
  Clock3,
  Gauge,
  MapPin,
  Route,
  Thermometer,
  Zap,
} from "lucide-react";

import { BrandBadge } from "@/components/brand/BrandBadge";
import { LogoFull } from "@/components/brand/LogoFull";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import { useBydmateTelemetryPointsQuery } from "@/hooks/use-bydmate-telemetry-points-query";
import { useTickingClock } from "@/hooks/use-ticking-clock";
import type {
  BydmateLiveSnapshotRow,
  BydmateTelemetry,
  BydmateTelemetryPointRow,
} from "@/types/database";

function fmt(value: number | null | undefined, digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function fmtBool(value: boolean | null | undefined) {
  if (value == null) return "—";
  return value ? "Yes" : "No";
}

function fmtTemp(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -50 || value > 90) {
    return "—";
  }
  return `${value.toFixed(digits)} °C`;
}

function timeAgo(iso: string, nowMs: number) {
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export function VehicleLiveView() {
  const { data, isLoading, error } = useBydmateLiveQuery();
  const {
    data: points,
    isLoading: isHistoryLoading,
    error: historyError,
  } = useBydmateTelemetryPointsQuery();
  const nowMs = useTickingClock(true);
  const snapshot = data?.[0] ?? null;

  if (isLoading) {
    return (
      <div className="safe-bottom flex flex-col gap-5 px-4 pb-6 pt-5">
        <Header />
        <Skeleton className="h-40 rounded-[1.75rem]" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-[1.5rem]" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="safe-bottom flex flex-col gap-5 px-4 pb-6 pt-5">
        <Header />
        <Card className="voltflow-card border-border bg-transparent">
          <CardContent className="p-6 text-muted-foreground">
            Could not load BYDMate telemetry.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!snapshot) {
    return <EmptyVehicleState />;
  }

  return (
    <div className="safe-bottom flex flex-col gap-5 px-4 pb-6 pt-5">
      <Header />
      <Hero snapshot={snapshot} nowMs={nowMs} />
      <TelemetryGrid telemetry={snapshot.telemetry} />
      <TelemetryHistoryCharts
        points={points ?? []}
        isLoading={isHistoryLoading}
        hasError={Boolean(historyError)}
      />
      <LocationCard snapshot={snapshot} />
    </div>
  );
}

function Header() {
  return (
    <header className="flex items-center justify-between gap-4">
      <LogoFull />
      <BrandBadge className="hidden min-[380px]:inline-flex">BYDMate live</BrandBadge>
    </header>
  );
}

function Hero({ snapshot, nowMs }: { snapshot: BydmateLiveSnapshotRow; nowMs: number }) {
  const t = snapshot.telemetry;
  const stale = nowMs - Date.parse(snapshot.received_at) > 90_000;

  return (
    <section className="voltflow-card overflow-hidden p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-[0.28em]">
            {snapshot.vehicle_id}
          </p>
          <h1 className="mt-3 font-heading text-5xl font-bold tracking-normal tabular-nums">
            {fmt(t.soc)}
            <span className="text-2xl text-muted-foreground">%</span>
          </h1>
          <p className="mt-2 text-muted-foreground">
            Last update {timeAgo(snapshot.received_at, nowMs)}
          </p>
        </div>
        <span
          className={
            "rounded-full border px-4 py-2 font-heading text-xs font-semibold uppercase tracking-[0.2em] " +
            (stale
              ? "border-yellow-300/25 bg-yellow-300/10 text-yellow-200"
              : "border-primary/25 bg-primary/10 text-primary")
          }
        >
          {stale ? "stale" : "live"}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <HeroMetric icon={Gauge} label="Speed" value={`${fmt(t.speed_kmh, 0)} km/h`} />
        <HeroMetric icon={Zap} label="Power" value={`${fmt(t.power_kw, 1)} kW`} />
        <HeroMetric icon={Route} label="Range" value={`${fmt(t.range_est_km, 0)} km`} />
      </div>
    </section>
  );
}

function HeroMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-white/[0.03] p-3">
      <Icon className="mb-2 size-4 text-primary" aria-hidden />
      <p className="text-muted-foreground text-[11px] uppercase tracking-[0.18em]">{label}</p>
      <p className="mt-1 font-heading text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function TelemetryGrid({ telemetry }: { telemetry: BydmateTelemetry }) {
  const items = [
    { icon: BatteryCharging, label: "Charging", value: fmtBool(telemetry.is_charging) },
    { icon: Zap, label: "Charge power", value: `${fmt(telemetry.charge_power_kw, 1)} kW` },
    { icon: Activity, label: "Charge type", value: telemetry.charge_type ?? "—" },
    { icon: Thermometer, label: "Battery temp", value: fmtTemp(telemetry.battery_temp_c) },
    { icon: Thermometer, label: "Cabin temp", value: fmtTemp(telemetry.cabin_temp_c) },
    { icon: Thermometer, label: "Outside temp", value: fmtTemp(telemetry.outside_temp_c) },
    { icon: Activity, label: "Odometer", value: `${fmt(telemetry.odometer_km, 1)} km` },
    { icon: Activity, label: "SoH", value: `${fmt(telemetry.soh_percent, 1)}%` },
    { icon: Zap, label: "12V battery", value: `${fmt(telemetry.aux_voltage_v, 1)} V` },
    { icon: Route, label: "Trip distance", value: `${fmt(telemetry.current_trip_distance_km, 1)} km` },
    {
      icon: Gauge,
      label: "Trip consumption",
      value: `${fmt(telemetry.current_trip_consumption_kwh_100km, 1)} kWh/100`,
    },
    { icon: BatteryCharging, label: "kWh charged", value: `${fmt(telemetry.kwh_charged, 2)} kWh` },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => (
        <Card key={item.label} className="border-border bg-white/[0.02]">
          <CardContent className="p-4">
            <item.icon className="mb-3 size-5 text-primary" aria-hidden />
            <p className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
              {item.label}
            </p>
            <p className="mt-2 font-heading text-xl font-semibold tracking-normal tabular-nums">
              {item.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

type ChartPoint = {
  time: number;
  value: number;
};

type ChartSeries = {
  label: string;
  color: string;
  points: ChartPoint[];
};

function validNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validTempNumber(value: number | null | undefined) {
  const n = validNumber(value);
  return n != null && n >= -50 && n <= 90 ? n : null;
}

function seriesFromPoints(
  points: BydmateTelemetryPointRow[],
  key: keyof BydmateTelemetry,
  label: string,
  color: string,
  normalize: (value: number | null | undefined) => number | null = validNumber,
): ChartSeries {
  return {
    label,
    color,
    points: points.flatMap((point) => {
      const value = normalize(point.telemetry[key] as number | null | undefined);
      const time = Date.parse(point.received_at);
      return value != null && Number.isFinite(time) ? [{ time, value }] : [];
    }),
  };
}

function TelemetryHistoryCharts({
  points,
  isLoading,
  hasError,
}: {
  points: BydmateTelemetryPointRow[];
  isLoading: boolean;
  hasError: boolean;
}) {
  const visiblePoints = points.filter((point) => point.telemetry);
  const start = visiblePoints[0]?.received_at;
  const end = visiblePoints.at(-1)?.received_at;

  const charts = [
    {
      title: "SOC",
      unit: "%",
      series: [seriesFromPoints(visiblePoints, "soc", "SOC", "var(--voltflow-cyan)")],
    },
    {
      title: "Speed",
      unit: "km/h",
      series: [seriesFromPoints(visiblePoints, "speed_kmh", "Speed", "#7dd3fc")],
    },
    {
      title: "Power",
      unit: "kW",
      series: [seriesFromPoints(visiblePoints, "power_kw", "Power", "#facc15")],
    },
    {
      title: "Temperatures",
      unit: "°C",
      series: [
        seriesFromPoints(visiblePoints, "battery_temp_c", "Battery", "#22c55e", validTempNumber),
        seriesFromPoints(visiblePoints, "outside_temp_c", "Outside", "#38bdf8", validTempNumber),
        seriesFromPoints(visiblePoints, "cabin_temp_c", "Cabin", "#fb7185", validTempNumber),
      ],
    },
  ];

  return (
    <section className="voltflow-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Telemetry history
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Last {visiblePoints.length} cloud points
            {start && end ? ` · ${new Date(start).toLocaleTimeString()} - ${new Date(end).toLocaleTimeString()}` : ""}
          </p>
        </div>
        <span className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          15s refresh
        </span>
      </div>

      {isLoading ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : hasError ? (
        <p className="mt-5 rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          Could not load telemetry history.
        </p>
      ) : visiblePoints.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          History will appear after CloudEV Mate sends telemetry points.
        </p>
      ) : (
        <>
          {visiblePoints.length < 2 ? (
            <p className="mt-5 rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm text-primary">
              One point received. Charts will turn into lines after the next cloud payload.
            </p>
          ) : null}
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {charts.map((chart) => (
              <TelemetryLineChart
                key={chart.title}
                title={chart.title}
                unit={chart.unit}
                series={chart.series}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TelemetryLineChart({
  title,
  unit,
  series,
}: {
  title: string;
  unit: string;
  series: ChartSeries[];
}) {
  const allPoints = series.flatMap((item) => item.points);
  const values = allPoints.map((point) => point.value);
  const times = allPoints.map((point) => point.time);
  const hasData = allPoints.length > 0;
  const minValue = hasData ? Math.min(...values) : 0;
  const maxValue = hasData ? Math.max(...values) : 1;
  const minTime = hasData ? Math.min(...times) : 0;
  const maxTime = hasData ? Math.max(...times) : 1;
  const valuePad = Math.max((maxValue - minValue) * 0.12, maxValue === minValue ? 1 : 0);
  const yMin = minValue - valuePad;
  const yMax = maxValue + valuePad;

  const x = (time: number) => {
    if (maxTime === minTime) return 160;
    return 18 + ((time - minTime) / (maxTime - minTime)) * 284;
  };
  const y = (value: number) => {
    if (yMax === yMin) return 60;
    return 104 - ((value - yMin) / (yMax - yMin)) * 88;
  };

  return (
    <article className="rounded-2xl border border-border bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-lg font-semibold tracking-tight">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {hasData ? `${fmt(minValue, 1)}-${fmt(maxValue, 1)} ${unit}` : "No values"}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {series.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <svg className="mt-4 h-36 w-full overflow-visible" viewBox="0 0 320 128" role="img" aria-label={`${title} history chart`}>
        <line x1="18" x2="302" y1="104" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" />
        <line x1="18" x2="302" y1="16" y2="16" stroke="currentColor" className="text-border/60" strokeWidth="1" strokeDasharray="4 6" />
        {series.map((item) => {
          const d = item.points
            .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(2)} ${y(point.value).toFixed(2)}`)
            .join(" ");
          return (
            <g key={item.label}>
              {item.points.length > 1 ? (
                <path d={d} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              ) : null}
              {item.points.map((point) => (
                <circle key={`${item.label}-${point.time}`} cx={x(point.time)} cy={y(point.value)} r="3.5" fill={item.color} />
              ))}
            </g>
          );
        })}
      </svg>
    </article>
  );
}

function LocationCard({ snapshot }: { snapshot: BydmateLiveSnapshotRow }) {
  const loc = snapshot.location;
  const hasLocation = typeof loc.lat === "number" && typeof loc.lon === "number";

  return (
    <Card className="voltflow-card border-border bg-transparent">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-xl tracking-tight">
          <MapPin className="size-5 text-primary" aria-hidden />
          Location
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-base">
        {hasLocation ? (
          <>
            <Row label="Latitude" value={fmt(loc.lat, 6)} />
            <Row label="Longitude" value={fmt(loc.lon, 6)} />
            <Row label="Accuracy" value={`${fmt(loc.accuracy_m, 1)} m`} />
            <Row label="Bearing" value={`${fmt(loc.bearing_deg, 0)}°`} />
          </>
        ) : (
          <p className="text-muted-foreground">
            No GPS in the latest payload. BYDMate sends location only when Android location permission is granted.
          </p>
        )}
        <Row label="Device time" value={new Date(snapshot.device_time).toLocaleString()} />
        <Row label="Received" value={new Date(snapshot.received_at).toLocaleString()} />
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border py-3 first:border-t-0 first:pt-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-heading font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function EmptyVehicleState() {
  return (
    <div className="safe-bottom flex flex-col gap-5 px-4 pb-6 pt-5">
      <Header />
      <section className="voltflow-card p-6">
        <CarFront className="size-10 text-primary" aria-hidden />
        <h1 className="mt-5 font-heading text-3xl font-bold tracking-normal">
          No car data yet
        </h1>
        <p className="mt-3 text-muted-foreground leading-7">
          Generate a BYDMate key in Settings, paste it into the Android app, and set
          the endpoint to <span className="font-mono">/api/bydmate/telemetry</span>.
          The first accepted payload will appear here.
        </p>
        <div className="mt-5 rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          <Clock3 className="mb-2 size-4 text-primary" aria-hidden />
          The page refreshes every 5 seconds while open.
        </div>
      </section>
    </div>
  );
}
