import type { SupabaseClient } from "@supabase/supabase-js";

import { deriveSessionProgressFromSoc } from "@/lib/charging-math";
import { isAtHomeCharger } from "@/lib/home-charger-geofence";
import type { TelemetryPayload } from "@/lib/bydmate/ingest-payload";
import {
  nextAutoChargingSessionStep,
  type AutoChargingSessionState,
} from "@/lib/bydmate/charging-auto-session-step";
import {
  finiteTelemetryNumber,
  isTelemetryCharging,
  telemetrySpeedKmh,
} from "@/lib/bydmate/telemetry-charging";
import type { Car, ChargingSessionRow } from "@/types/database";

const DEFAULT_TARGET_PERCENT = 100;

export type { AutoChargingSessionState, AutoChargingSessionAction } from "@/lib/bydmate/charging-auto-session-step";
export { nextAutoChargingSessionStep } from "@/lib/bydmate/charging-auto-session-step";

type AutoChargingStateRow = {
  user_id: string;
  vehicle_id: string;
  consecutive_charging_samples: number;
  consecutive_unplug_samples: number;
  last_is_charging: boolean;
  last_device_time: string | null;
};

function stateFromRow(row: AutoChargingStateRow): AutoChargingSessionState {
  return {
    consecutiveChargingSamples: row.consecutive_charging_samples,
    consecutiveUnplugSamples: row.consecutive_unplug_samples,
    lastIsCharging: row.last_is_charging === true,
  };
}

function stateToRow(
  userId: string,
  vehicleId: string,
  deviceTime: string,
  state: AutoChargingSessionState,
) {
  return {
    user_id: userId,
    vehicle_id: vehicleId,
    consecutive_charging_samples: state.consecutiveChargingSamples,
    consecutive_unplug_samples: state.consecutiveUnplugSamples,
    last_is_charging: state.lastIsCharging,
    last_device_time: deviceTime,
  };
}

async function resolvePricePerKwh(
  supabase: SupabaseClient,
  userId: string,
  car: Car,
  sample: TelemetryPayload,
) {
  const location = sample.location;
  if (isAtHomeCharger(location, car)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("default_price_per_kwh")
      .eq("id", userId)
      .maybeSingle();
    return Number(profile?.default_price_per_kwh ?? 0);
  }
  return 0;
}

async function closeOpenChargingSessions(supabase: SupabaseClient, userId: string, stoppedAt: string) {
  await supabase
    .from("charging_sessions")
    .update({ status: "stopped", stopped_at: stoppedAt })
    .eq("user_id", userId)
    .eq("status", "charging");
}

async function startSessionFromTelemetry({
  supabase,
  userId,
  car,
  sample,
  startPercent,
  chargerPowerKw,
}: {
  supabase: SupabaseClient;
  userId: string;
  car: Car;
  sample: TelemetryPayload;
  startPercent: number;
  chargerPowerKw: number;
}) {
  const startedAt = sample.device_time;
  await closeOpenChargingSessions(supabase, userId, startedAt);
  const pricePerKwh = await resolvePricePerKwh(supabase, userId, car, sample);
  const chargerPower = Math.min(350, Math.max(chargerPowerKw, 0.1));

  const { data: session, error } = await supabase
    .from("charging_sessions")
    .insert({
      user_id: userId,
      car_id: car.id,
      start_percent: startPercent,
      current_percent: startPercent,
      target_percent: DEFAULT_TARGET_PERCENT,
      battery_capacity_kwh: car.battery_capacity_kwh,
      charger_power_kw: chargerPower,
      efficiency_percent: car.default_efficiency_percent,
      price_per_kwh: pricePerKwh,
      charged_energy_kwh: 0,
      estimated_cost: 0,
      status: "charging",
      started_at: startedAt,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return session?.id ?? null;
}

async function stopSessionFromTelemetry({
  supabase,
  session,
  car,
  currentPercent,
  stoppedAt,
}: {
  supabase: SupabaseClient;
  session: ChargingSessionRow;
  car: Car;
  currentPercent: number;
  stoppedAt: string;
}) {
  const progress = deriveSessionProgressFromSoc(
    {
      startPercent: session.start_percent,
      targetPercent: session.target_percent,
      batteryCapacityKwh: car.battery_capacity_kwh,
      chargerPowerKw: session.charger_power_kw,
      efficiencyPercent: car.default_efficiency_percent,
      pricePerKwh: session.price_per_kwh,
    },
    currentPercent,
  );

  const { error } = await supabase
    .from("charging_sessions")
    .update({
      current_percent: progress.currentPercent,
      charged_energy_kwh: progress.chargedEnergyKwh,
      estimated_cost: progress.estimatedCost,
      status: "stopped",
      stopped_at: stoppedAt,
    })
    .eq("id", session.id);

  if (error) throw new Error(error.message);
}

export async function processBydmateAutoChargingSessions({
  supabase,
  userId,
  samples,
}: {
  supabase: SupabaseClient;
  userId: string;
  samples: TelemetryPayload[];
}) {
  if (!samples.length) {
    return { started: 0, stopped: 0, sessionIds: [] as string[] };
  }

  const vehicleIds = Array.from(new Set(samples.map((sample) => sample.vehicle_id)));
  const orderedSamples = [...samples].sort(
    (a, b) => Date.parse(a.device_time) - Date.parse(b.device_time),
  );

  const [{ data: cars, error: carsError }, { data: activeSessions, error: sessionsError }, { data: stateRows, error: stateError }] =
    await Promise.all([
      supabase.from("cars").select("*").eq("user_id", userId).in("vehicle_alias", vehicleIds),
      supabase.from("charging_sessions").select("*").eq("user_id", userId).eq("status", "charging"),
      supabase
        .from("bydmate_auto_charging_session_state")
        .select(
          "user_id,vehicle_id,consecutive_charging_samples,consecutive_unplug_samples,last_is_charging,last_device_time",
        )
        .eq("user_id", userId)
        .in("vehicle_id", vehicleIds),
    ]);

  if (carsError) throw new Error(carsError.message);
  if (sessionsError) throw new Error(sessionsError.message);
  if (stateError) throw new Error(stateError.message);

  const carsByVehicleId = new Map<string, Car>();
  for (const car of (cars ?? []) as Car[]) {
    if (car.vehicle_alias && !carsByVehicleId.has(car.vehicle_alias)) {
      carsByVehicleId.set(car.vehicle_alias, car);
    }
  }

  const activeByCarId = new Map<string, ChargingSessionRow>();
  for (const session of (activeSessions ?? []) as ChargingSessionRow[]) {
    activeByCarId.set(session.car_id, session);
  }

  const states = new Map<string, AutoChargingSessionState>();
  for (const row of (stateRows ?? []) as AutoChargingStateRow[]) {
    states.set(row.vehicle_id, stateFromRow(row));
  }

  let started = 0;
  let stopped = 0;
  const sessionIds: string[] = [];

  for (const sample of orderedSamples) {
    const car = carsByVehicleId.get(sample.vehicle_id);
    if (!car) continue;

    const isCharging = isTelemetryCharging(sample.telemetry);
    const soc = finiteTelemetryNumber(sample.telemetry.soc);
    const speedKmh = telemetrySpeedKmh(sample.telemetry);
    const chargePowerKw = finiteTelemetryNumber(sample.telemetry.charge_power_kw);
    const activeSession = activeByCarId.get(car.id) ?? null;

    const step = nextAutoChargingSessionStep({
      state: states.get(sample.vehicle_id) ?? null,
      isCharging,
      soc,
      speedKmh,
      hasActiveSession: Boolean(activeSession),
      chargerPowerKw: chargePowerKw ?? car.default_charger_power_kw,
    });

    states.set(sample.vehicle_id, step.state);

    if (step.action.type === "start") {
      const sessionId = await startSessionFromTelemetry({
        supabase,
        userId,
        car,
        sample,
        startPercent: step.action.startPercent,
        chargerPowerKw: step.action.chargerPowerKw,
      });
      if (sessionId) {
        started += 1;
        sessionIds.push(sessionId);
        const { data: freshSession } = await supabase
          .from("charging_sessions")
          .select("*")
          .eq("id", sessionId)
          .single();
        if (freshSession) activeByCarId.set(car.id, freshSession as ChargingSessionRow);
      }
      continue;
    }

    if (step.action.type === "stop" && activeSession) {
      await stopSessionFromTelemetry({
        supabase,
        session: activeSession,
        car,
        currentPercent: step.action.currentPercent,
        stoppedAt: sample.device_time,
      });
      activeByCarId.delete(car.id);
      stopped += 1;
    }
  }

  for (const vehicleId of vehicleIds) {
    const state = states.get(vehicleId);
    if (!state) continue;
    const lastSample = [...orderedSamples].reverse().find((sample) => sample.vehicle_id === vehicleId);
    const deviceTime = lastSample?.device_time ?? new Date().toISOString();
    const { error: upsertError } = await supabase
      .from("bydmate_auto_charging_session_state")
      .upsert(stateToRow(userId, vehicleId, deviceTime, state), {
        onConflict: "user_id,vehicle_id",
      });
    if (upsertError) throw new Error(upsertError.message);
  }

  return { started, stopped, sessionIds };
}
