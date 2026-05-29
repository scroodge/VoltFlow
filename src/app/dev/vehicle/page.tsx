import { notFound } from "next/navigation";

import type { ChargingSampleRef } from "@/app/dev/vehicle-telemetry-fixtures/build-charging-snapshot";
import { VehicleFixtureModeSwitch } from "@/app/dev/vehicle-telemetry-fixtures/VehicleFixtureModeSwitch";
import { createServiceClient } from "@/lib/supabase/service";
import type {
  BydmateLiveSnapshotRow,
  BydmateTelemetryPointRow,
} from "@/types/database";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const DEFAULT_VEHICLE_ID = "way";
const SAMPLE_LIMIT = 420;

type SampleRow = {
  id: string;
  vehicle_id: string;
  user_id: string;
  device_time: string;
  received_at: string;
  telemetry: BydmateTelemetryPointRow["telemetry"];
  diplus?: BydmateTelemetryPointRow["diplus"];
  diplus_min_cell_voltage_v?: number | null;
  diplus_max_cell_voltage_v?: number | null;
  diplus_cell_delta_v?: number | null;
};

export default async function DevVehiclePage({
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

  const { data: liveRows, error: liveError } = await supabase
    .from("bydmate_live_snapshots")
    .select("id, vehicle_id, user_id, source, schema_version, device_time, received_at, telemetry, diplus, location, raw_payload, updated_at, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v")
    .eq("vehicle_id", vehicleId)
    .order("received_at", { ascending: false })
    .limit(1);

  const { data: sampleRows, error: samplesError } = await supabase
    .from("bydmate_telemetry_samples")
    .select("id, vehicle_id, user_id, device_time, received_at, telemetry, diplus, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v")
    .eq("vehicle_id", vehicleId)
    .order("device_time", { ascending: false })
    .limit(SAMPLE_LIMIT);

  const { data: chargingRows } = await supabase
    .from("bydmate_telemetry_samples")
    .select("device_time, received_at, telemetry, diplus, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v")
    .eq("vehicle_id", vehicleId)
    .eq("telemetry->>is_charging", "true")
    .order("device_time", { ascending: false })
    .limit(1);

  const snapshot = ((liveRows ?? []) as BydmateLiveSnapshotRow[])[0] ?? null;
  const chargingSample = ((chargingRows ?? [])[0] as ChargingSampleRef | undefined) ?? null;
  const points = ((sampleRows ?? []) as SampleRow[])
    .map(sampleToPoint)
    .sort((a, b) => Date.parse(a.device_time) - Date.parse(b.device_time));

  if (liveError || samplesError) {
    return (
      <main className="mx-auto max-w-lg px-4 py-8 text-sm">
        {liveError ? <p className="text-destructive">Live query: {liveError.message}</p> : null}
        {samplesError ? <p className="text-destructive">Samples query: {samplesError.message}</p> : null}
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="mx-auto max-w-lg px-4 py-8 text-sm text-muted-foreground">
        No live snapshot found for <span className="font-mono">{vehicleId}</span>.
      </main>
    );
  }

  return (
    <VehicleFixtureModeSwitch
      snapshot={snapshot}
      points={points}
      vehicleId={vehicleId}
      chargingSample={chargingSample}
    />
  );
}

function sampleToPoint(sample: SampleRow): BydmateTelemetryPointRow {
  return {
    id: sample.id,
    vehicle_id: sample.vehicle_id,
    user_id: sample.user_id,
    source: "BYDMate",
    schema_version: 1,
    device_time: sample.device_time,
    received_at: sample.received_at,
    telemetry: sample.telemetry ?? {},
    diplus: sample.diplus ?? {},
    location: {},
    raw_payload: null,
    diplus_min_cell_voltage_v: sample.diplus_min_cell_voltage_v,
    diplus_max_cell_voltage_v: sample.diplus_max_cell_voltage_v,
    diplus_cell_delta_v: sample.diplus_cell_delta_v,
  };
}

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}
