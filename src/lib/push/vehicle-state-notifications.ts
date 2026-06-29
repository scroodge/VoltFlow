import type { SupabaseClient } from "@supabase/supabase-js";

import type { TelemetryPayload } from "@/lib/bydmate/ingest-payload";
import { finiteTelemetryNumber } from "@/lib/bydmate/telemetry-charging";
import {
  gearIsPark,
} from "@/lib/bydmate/gear";
import {
  sendTelegramLocation,
  sendTelegramMessage,
} from "@/lib/telegram/bot-send";

const DISCONNECTED_AFTER_MS = 10 * 60 * 1000;
const CONNECTED_GAP_MS = 5 * 60 * 1000;
const PARK_NOTIFICATION_COOLDOWN_MS = 60 * 1000;

type VehicleStateRow = {
  user_id: string;
  vehicle_id: string;
  last_device_time: string | null;
  last_received_at: string | null;
  last_soc: number | null;
  last_odometer_km: number | null;
  last_lat: number | null;
  last_lon: number | null;
  last_is_parked: boolean | null;
  last_connected_at: string | null;
  last_disconnected_at: string | null;
  last_park_notified_at: string | null;
};

function finiteSoc(value: unknown): number | null {
  const n = finiteTelemetryNumber(value);
  return n != null && n >= 0 && n <= 100 ? Math.round(n) : null;
}

function finiteOdometer(value: unknown): number | null {
  const n = finiteTelemetryNumber(value);
  return n != null && n >= 0 ? Math.round(n) : null;
}

async function loadTelegramProfile(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("telegram_id, notify_channel")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return { telegramId: null as number | string | null, channel: "web_push" as const };

  const row = data as Record<string, unknown>;
  const telegramId = row.telegram_id != null ? (row.telegram_id as number | string) : null;
  const notifyChannel = row.notify_channel as string | undefined;

  return {
    telegramId,
    channel: notifyChannel === "telegram" || notifyChannel === "both"
      ? notifyChannel
      : "web_push" as const,
  };
}

function notificationText(
  carName: string,
  event: "connected" | "disconnected" | "parked",
  odometer: number | null,
  soc: number | null,
): string {
  const namePart = carName || "Автомобиль";
  let prefix: string;
  switch (event) {
    case "connected":
      prefix = `${namePart} подключился к сети`;
      break;
    case "disconnected":
      prefix = `${namePart} отключен от сети`;
      break;
    case "parked":
      prefix = `${namePart} в режиме стоянки`;
      break;
  }
  const parts: string[] = [prefix];
  if (odometer != null) parts.push(`${odometer} км`);
  if (soc != null) parts.push(`Батарея ${soc}%`);
  return parts.join("\n");
}

function extractVehicleInfo(sample: TelemetryPayload) {
  const soc = finiteSoc(sample.telemetry.soc) ?? finiteSoc(sample.diplus?.soc);
  const odometer = finiteOdometer(sample.telemetry.odometer_km) ?? finiteOdometer(sample.diplus?.mileage_km);
  const lat = finiteTelemetryNumber(sample.location?.lat);
  const lon = finiteTelemetryNumber(sample.location?.lon);
  return { soc, odometer, lat, lon };
}

function isGearP(sample: TelemetryPayload): boolean {
  const gear = sample.diplus?.gear;
  if (gear == null) return false;
  const speed = finiteTelemetryNumber(sample.telemetry.speed_kmh);
  if (speed != null && speed > 5) return false;
  return gearIsPark(gear);
}

export async function processBydmateVehicleStateNotifications({
  supabase,
  userId,
  samples,
  receivedAt,
}: {
  supabase: SupabaseClient;
  userId: string;
  samples: TelemetryPayload[];
  receivedAt: string;
}) {
  const orderedSamples = [...samples].sort(
    (a, b) => Date.parse(a.device_time) - Date.parse(b.device_time),
  );

  const vehicleIds = Array.from(new Set(orderedSamples.map((s) => s.vehicle_id)));
  if (!vehicleIds.length) return { connected: 0, parked: 0, disconnected: 0 };

  const profile = await loadTelegramProfile(supabase, userId);
  const shouldSendTelegram = profile.telegramId != null;

  if (!shouldSendTelegram && samples.length > 0) {
    console.log("vehicle state: skipped — no telegram_id for user", userId);
  }

  const { data: stateRows } = await supabase
    .from("bydmate_vehicle_state_notifications")
    .select("*")
    .eq("user_id", userId)
    .in("vehicle_id", vehicleIds);

  const states = new Map<string, VehicleStateRow>();
  for (const row of (stateRows ?? []) as VehicleStateRow[]) {
    states.set(row.vehicle_id, row);
  }

  const { data: carRows } = await supabase
    .from("cars")
    .select("name, vehicle_alias")
    .eq("user_id", userId)
    .in("vehicle_alias", vehicleIds);

  const carNames = new Map<string, string>();
  for (const row of (carRows ?? []) as { name: string; vehicle_alias: string | null }[]) {
    if (row.vehicle_alias) {
      carNames.set(row.vehicle_alias, row.name);
    }
  }

  let connected = 0;
  let parked = 0;
  let disconnected = 0;

  const now = new Date(receivedAt).getTime();

  for (const vehicleId of vehicleIds) {
    const lastSample = [...orderedSamples].reverse().find((s) => s.vehicle_id === vehicleId);
    if (!lastSample) continue;

    const prevState = states.get(vehicleId) ?? null;
    const carName = carNames.get(vehicleId) ?? "Автомобиль";

    const { soc, odometer, lat, lon } = extractVehicleInfo(lastSample);
    const isParked = isGearP(lastSample);

    if (shouldSendTelegram) {
      console.log("vehicle state:", vehicleId, "prevState:", !!prevState, "parked:", isParked, "soc:", soc, "odo:", odometer);
    }

    if (prevState?.last_received_at) {
      const lastReceived = new Date(prevState.last_received_at).getTime();
      const gapMs = now - lastReceived;

      if (gapMs > DISCONNECTED_AFTER_MS) {
        const discoNotifiedAt = prevState.last_disconnected_at
          ? new Date(prevState.last_disconnected_at).getTime()
          : 0;
        const alreadyNotified = discoNotifiedAt >= lastReceived;

        if (!alreadyNotified && shouldSendTelegram && profile.telegramId != null) {
          const discText = notificationText(
            carName,
            "disconnected",
            prevState.last_odometer_km != null ? Math.round(prevState.last_odometer_km) : null,
            prevState.last_soc != null ? Math.round(prevState.last_soc) : null,
          );
          await sendTelegramMessage(profile.telegramId, discText);
          if (prevState.last_lat != null && prevState.last_lon != null) {
            await sendTelegramLocation(profile.telegramId, prevState.last_lat, prevState.last_lon);
          }
          disconnected++;
        }
      }

      if (gapMs > CONNECTED_GAP_MS) {
        if (shouldSendTelegram && profile.telegramId != null) {
          const connText = notificationText(carName, "connected", odometer, soc);
          await sendTelegramMessage(profile.telegramId, connText);
          if (lat != null && lon != null) {
            await sendTelegramLocation(profile.telegramId, lat, lon);
          }
          connected++;
        }
      }
    } else if (!prevState) {
      if (shouldSendTelegram && profile.telegramId != null) {
        const connText = notificationText(carName, "connected", odometer, soc);
        await sendTelegramMessage(profile.telegramId, connText);
        if (lat != null && lon != null) {
          await sendTelegramLocation(profile.telegramId, lat, lon);
        }
        connected++;
      }
    }

    if (isParked && (!prevState || !prevState.last_is_parked)) {
      const parkCooldownOk = !prevState?.last_park_notified_at
        || now - new Date(prevState.last_park_notified_at).getTime() > PARK_NOTIFICATION_COOLDOWN_MS;

      if (parkCooldownOk && shouldSendTelegram && profile.telegramId != null) {
        const parkText = notificationText(carName, "parked", odometer, soc);
        await sendTelegramMessage(profile.telegramId, parkText);
        if (lat != null && lon != null) {
          await sendTelegramLocation(profile.telegramId, lat, lon);
        }
        parked++;
      }
    }

    const { error: upsertError } = await supabase
      .from("bydmate_vehicle_state_notifications")
      .upsert({
        user_id: userId,
        vehicle_id: vehicleId,
        last_device_time: lastSample.device_time,
        last_received_at: receivedAt,
        last_soc: soc,
        last_odometer_km: odometer,
        last_lat: lat,
        last_lon: lon,
        last_is_parked: isParked,
        last_connected_at: connected > 0 ? receivedAt : (prevState?.last_connected_at ?? null),
        last_disconnected_at: disconnected > 0 ? receivedAt : (prevState?.last_disconnected_at ?? null),
        last_park_notified_at: parked > 0 ? receivedAt : (prevState?.last_park_notified_at ?? null),
      }, { onConflict: "user_id,vehicle_id" });

    if (upsertError) {
      console.error("vehicle state notification upsert:", upsertError.message);
    }
  }

  return { connected, parked, disconnected };
}
