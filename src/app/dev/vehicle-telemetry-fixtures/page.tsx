import { notFound } from "next/navigation";

import {
  RouteMap,
  TelemetryHistoryCharts,
} from "@/components/vehicle/vehicle-live-view";
import type {
  BydmateLiveSnapshotRow,
  BydmateLocation,
  BydmateTelemetry,
  BydmateTelemetryPointRow,
} from "@/types/database";
import { VehicleFixtureModeSwitch } from "./VehicleFixtureModeSwitch";

const BASE_TIME_MS = Date.UTC(2026, 4, 19, 8, 0, 0);

export default function VehicleTelemetryFixturesPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const denseTrip = makeTelemetryPoints(2_000, {
    idPrefix: "dense",
    startMs: BASE_TIME_MS,
    intervalMs: 15_000,
    gps: "normal",
  });
  const onePoint = makeTelemetryPoints(1, {
    idPrefix: "one",
    startMs: BASE_TIME_MS + 2 * 60 * 60_000,
    intervalMs: 15_000,
    gps: "normal",
  });
  const repeatedTimestamps = makeTelemetryPoints(80, {
    idPrefix: "repeated-time",
    startMs: BASE_TIME_MS + 3 * 60 * 60_000,
    intervalMs: 0,
    gps: "normal",
  });
  const missingGps = makeTelemetryPoints(120, {
    idPrefix: "missing-gps",
    startMs: BASE_TIME_MS + 4 * 60 * 60_000,
    intervalMs: 15_000,
    gps: "missing",
  });
  const vehiclePageTrips = [
    ...makeTelemetryPoints(48, {
      idPrefix: "mock-morning",
      startMs: BASE_TIME_MS - 90 * 60_000,
      intervalMs: 15_000,
      gps: "normal",
    }),
    ...makeTelemetryPoints(36, {
      idPrefix: "mock-lunch",
      startMs: BASE_TIME_MS + 45 * 60_000,
      intervalMs: 15_000,
      gps: "normal",
    }),
    ...makeTelemetryPoints(52, {
      idPrefix: "mock-evening",
      startMs: BASE_TIME_MS + 3 * 60 * 60_000,
      intervalMs: 15_000,
      gps: "normal",
    }),
  ];
  const liveSnapshot = makeLiveSnapshot(vehiclePageTrips.at(-1) ?? denseTrip[0]);

  return (
    <main className="safe-bottom mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-8 pt-5">
      <header>
        <p className="text-muted-foreground text-xs uppercase tracking-[0.24em]">
          Dev fixture
        </p>
        <h1 className="mt-2 font-heading text-3xl font-bold tracking-normal">
          Vehicle telemetry visual QA
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Synthetic trips for chart and route edge cases. This route is only
          available outside production.
        </p>
      </header>

      <section className="grid gap-4">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Full vehicle page mock
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Auth-free fixture with three same-day trips, live car data, charts, route and the
            expandable trip list.
          </p>
        </div>
        <VehicleFixtureModeSwitch snapshot={liveSnapshot} points={vehiclePageTrips} vehicleId="fixture-car-live" />
      </section>

      <FixtureSection
        title="Dense trip"
        description="2,000 points at 15 second intervals with GPS movement."
        points={denseTrip}
      />
      <FixtureSection
        title="One point"
        description="Single telemetry point to verify point-only charts and route markers."
        points={onePoint}
      />
      <FixtureSection
        title="Repeated timestamps"
        description="Many values sharing the same timestamp to verify flat x-axis handling."
        points={repeatedTimestamps}
      />
      <FixtureSection
        title="Missing GPS"
        description="Telemetry values without latitude or longitude."
        points={missingGps}
      />
    </main>
  );
}

function FixtureSection({
  title,
  description,
  points,
}: {
  title: string;
  description: string;
  points: BydmateTelemetryPointRow[];
}) {
  return (
    <section className="grid gap-4">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {description} {points.length} generated points.
        </p>
      </div>
      <TelemetryHistoryCharts points={points} isLoading={false} hasError={false} />
      <RouteMap points={points} />
    </section>
  );
}

function makeTelemetryPoints(
  count: number,
  options: {
    idPrefix: string;
    startMs: number;
    intervalMs: number;
    gps: "normal" | "missing";
  },
): BydmateTelemetryPointRow[] {
  return Array.from({ length: count }, (_, index) => {
    const timestampMs = options.startMs + index * options.intervalMs;
    const wave = Math.sin(index / 22);
    const fastWave = Math.sin(index / 7);
    const telemetry: BydmateTelemetry = {
      soc: clamp(82 - index * 0.015 + wave * 0.4, 10, 100),
      speed_kmh: Math.max(0, 54 + wave * 22 + fastWave * 8),
      power_kw: -18 - wave * 11 + fastWave * 4,
      battery_temp_c: 27 + wave * 4,
      outside_temp_c: 18 + Math.sin(index / 36) * 5,
      cabin_temp_c: 21 + Math.cos(index / 30) * 2,
      odometer_km: 12_400 + index * 0.12,
      current_trip_distance_km: index * 0.12,
      current_trip_consumption_kwh_100km: 15.8 + wave * 1.4 + fastWave * 0.7,
      range_est_km: 360 - index * 0.04,
    };
    const minCellVoltage = 3.31 + Math.sin(index / 31) * 0.006;
    const cellDelta = 0.014 + Math.abs(Math.sin(index / 17)) * 0.018;
    const maxCellVoltage = minCellVoltage + cellDelta;

    return {
      id: `${options.idPrefix}-${index}`,
      vehicle_id: "fixture-car",
      user_id: "fixture-user",
      source: "BYDMate",
      schema_version: 1,
      device_time: new Date(timestampMs).toISOString(),
      received_at: new Date(timestampMs).toISOString(),
      telemetry,
      diplus: {
        min_cell_voltage_v: minCellVoltage,
        max_cell_voltage_v: maxCellVoltage,
        cell_delta_v: cellDelta,
      },
      diplus_min_cell_voltage_v: minCellVoltage,
      diplus_max_cell_voltage_v: maxCellVoltage,
      diplus_cell_delta_v: cellDelta,
      location: makeLocation(index, options.gps),
      raw_payload: null,
    };
  });
}

function makeLiveSnapshot(point: BydmateTelemetryPointRow): BydmateLiveSnapshotRow {
  return {
    ...point,
    id: "fixture-live-snapshot",
    vehicle_id: "fixture-car-live",
    received_at: new Date().toISOString(),
    telemetry: {
      ...point.telemetry,
      is_charging: false,
      charge_power_kw: 0,
      charge_type: "AC",
      battery_voltage_v: 382,
      aux_voltage_v: 12.7,
      soh_percent: 99.1,
      kwh_charged: 11.42,
    },
    updated_at: new Date().toISOString(),
  };
}

function makeLocation(index: number, gps: "normal" | "missing"): BydmateLocation {
  if (gps === "missing") return {};

  return {
    lat: 53.9006 + index * 0.00008 + Math.sin(index / 20) * 0.0005,
    lon: 27.559 + index * 0.00011 + Math.cos(index / 18) * 0.0005,
    accuracy_m: 8,
    bearing_deg: (index * 7) % 360,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
