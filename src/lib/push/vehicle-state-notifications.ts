import type { SupabaseClient } from "@supabase/supabase-js";

import type { TelemetryPayload } from "@/lib/bydmate/ingest-payload";
import { finiteTelemetryNumber } from "@/lib/bydmate/telemetry-charging";
import {
  gearIsPark,
} from "@/lib/bydmate/gear";
import { sendTelegramMessage } from "@/lib/telegram/bot-send";

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

function formatDurationHoursMinutes(totalHours: number): string {
  if (totalHours <= 0 || !Number.isFinite(totalHours)) return "";
  const h = Math.floor(totalHours);
  const m = Math.round((totalHours - h) * 60);
  if (h > 0 && m > 0) return `~${h}ч ${m}м`;
  if (h > 0) return `~${h}ч`;
  return `~${m}м`;
}

function chargeTimeToFull(
  soc: number | null,
  chargePowerKw: number | null,
  batteryCapacityKwh: number | null,
  efficiencyPercent: number | null,
): string | null {
  if (soc == null || chargePowerKw == null || batteryCapacityKwh == null || chargePowerKw <= 0 || soc >= 100) return null;
  const eff = (efficiencyPercent ?? 90) / 100;
  const remainingKwh = (batteryCapacityKwh * (100 - soc)) / 100 / eff;
  const hours = remainingKwh / chargePowerKw;
  return formatDurationHoursMinutes(hours);
}

function calcChargeCost(
  soc: number | null,
  batteryCapacityKwh: number | null,
  efficiencyPercent: number | null,
  pricePerKwh: number | null,
): number | null {
  if (soc == null || batteryCapacityKwh == null || pricePerKwh == null || pricePerKwh <= 0) return null;
  const eff = (efficiencyPercent ?? 90) / 100;
  const remainingKwh = (batteryCapacityKwh * (100 - soc)) / 100 / eff;
  return remainingKwh * pricePerKwh;
}

async function resolvePricePerKwh(
  supabase: SupabaseClient,
  userId: string,
  lat: number | null,
  lon: number | null,
  chargePowerKw: number,
): Promise<number> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("default_price_per_kwh, home_price_per_kwh, commercial_ac_price_per_kwh, fast_dc_price_per_kwh")
    .eq("id", userId)
    .maybeSingle();

  const p = profile as Record<string, unknown> | null;
  const defaultPrice = p != null ? Number(p.default_price_per_kwh ?? 0) : 0;
  const homePrice = p != null ? Number(p.home_price_per_kwh ?? defaultPrice) : defaultPrice;
  const acPrice = p != null ? Number(p.commercial_ac_price_per_kwh ?? defaultPrice) : defaultPrice;
  const dcPrice = p != null ? Number(p.fast_dc_price_per_kwh ?? defaultPrice) : defaultPrice;

  // If GPS available, try tariff location match
  if (lat != null && lon != null) {
    const { data: presets } = await supabase
      .from("charging_tariff_locations")
      .select("lat, lng, radius_m, tariff_type, price_per_kwh_override")
      .eq("user_id", userId);

    for (const loc of (presets ?? []) as Record<string, unknown>[]) {
      const radius = Number(loc.radius_m ?? 150);
      const locLat = Number(loc.lat);
      const locLng = Number(loc.lng);
      if (!Number.isFinite(radius) || !Number.isFinite(locLat) || !Number.isFinite(locLng)) continue;
      const d = haversineM(lat, lon, locLat, locLng);
      if (d <= radius) {
        const override = Number(loc.price_per_kwh_override ?? 0);
        if (override > 0) return override;
        const tType = String(loc.tariff_type ?? "");
        if (tType === "home") return homePrice;
        if (tType === "commercial_ac") return acPrice;
        if (tType === "fast_dc") return dcPrice;
        return defaultPrice;
      }
    }
  }

  // Power-based fallback
  if (chargePowerKw < 4) return homePrice;
  if (chargePowerKw < 10) return acPrice;
  return dcPrice;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Fallback: last trip's last track point when live snapshot has no GPS. */
async function fallbackLocation(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
): Promise<{ lat: number; lon: number } | null> {
  const { data } = await supabase
    .from("bydmate_trips")
    .select("id")
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: false })
    .limit(1);

  const tripId = (data as { id: string }[] | null)?.[0]?.id;
  if (!tripId) return null;

  const { data: points } = await supabase
    .from("bydmate_trip_track_points")
    .select("lat, lon")
    .eq("user_id", userId)
    .eq("trip_id", tripId)
    .order("device_time", { ascending: false })
    .limit(1);

  const last = (points as { lat: number; lon: number }[] | null)?.[0];
  if (!last) return null;

  const lat = finiteTelemetryNumber(last.lat);
  const lon = finiteTelemetryNumber(last.lon);
  return lat != null && lon != null ? { lat, lon } : null;
}

async function loadTelegramProfile(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("telegram_id, notify_channel, timezone")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return { telegramId: null as number | string | null, channel: "web_push" as const, timezone: "Europe/Minsk" };

  const row = data as Record<string, unknown>;
  const telegramId = row.telegram_id != null ? (row.telegram_id as number | string) : null;
  const notifyChannel = row.notify_channel as string | undefined;

  return {
    telegramId,
    channel: notifyChannel === "telegram" || notifyChannel === "both"
      ? notifyChannel
      : "web_push" as const,
    timezone: (row.timezone as string) || "Europe/Minsk",
  };
}

function notificationText(
  carName: string,
  event: "connected" | "disconnected" | "parked",
  odometer: number | null,
  soc: number | null,
  deviceTime?: string,
  lat?: number | null,
  lon?: number | null,
  timeToFull?: string | null,
  cost?: number | null,
  currency?: string,
  chargePowerKw?: number | null,
  timezone?: string,
): string {
  const namePart = carName || "Автомобиль";
  let prefix: string;
  switch (event) {
    case "connected":
      prefix = `ℹ️ Ваш автомобиль ${namePart} подключился к сети`;
      break;
    case "disconnected":
      prefix = `ℹ️ Ваш автомобиль ${namePart} отключен от сети`;
      break;
    case "parked":
      prefix = `ℹ️ Ваш автомобиль ${namePart} в режиме стоянки`;
      break;
  }
  const line1 = `${prefix}.`;
  const statusParts: string[] = [];
  if (odometer != null) statusParts.push(`Пробег ${odometer} км`);
  if (soc != null) statusParts.push(`🔋 ${soc}%`);
  if (deviceTime) {
    const d = new Date(deviceTime);
    if (!Number.isNaN(d.getTime())) {
      const tz = timezone || "Europe/Minsk";
      const timeStr = d.toLocaleTimeString("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
      statusParts.push(`Время ${timeStr}`);
    }
  }
  const line2 = statusParts.join(". ");

  let result = line1;
  if (line2) result += `\n${line2}`;

  // connected: third line = map link only (no charging calc)
  if (event === "connected") {
    if (lat != null && lon != null) result += `\nhttps://www.google.com/maps?q=${lat},${lon}`;
    return result;
  }

  // disconnected / parked: third line = charging calc + map link
  const isCharging = chargePowerKw != null && chargePowerKw > 0;
  if (isCharging) {
    const kw = chargePowerKw!.toFixed(1);
    let line3 = `Время Зарядки при ${kw} кВт.`;
    if (timeToFull) line3 += ` составит ${timeToFull} до 100%`;
    if (cost != null && cost > 0) {
      const sym = currency === "EUR" ? "€" : currency === "USD" ? "$" : currency === "BYN" ? "Br" : currency === "RUB" ? "₽" : "";
      line3 += `. 💰 ${cost.toFixed(2)}${sym}`;
    }
    if (lat != null && lon != null) line3 += `. https://www.google.com/maps?q=${lat},${lon}`;
    result += `\n${line3}`;
  } else if (lat != null && lon != null) {
    result += `\nhttps://www.google.com/maps?q=${lat},${lon}`;
  }
  return result;
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
    .select("name, vehicle_alias, battery_capacity_kwh, default_charger_power_kw, default_efficiency_percent")
    .eq("user_id", userId)
    .in("vehicle_alias", vehicleIds);

  const carNames = new Map<string, string>();
  const carData = new Map<string, { batteryCapacityKwh: number; chargerPowerKw: number; efficiencyPercent: number }>();
  for (const row of (carRows ?? []) as Record<string, unknown>[]) {
    const alias = String(row.vehicle_alias ?? "");
    if (alias) {
      carNames.set(alias, String(row.name ?? "Автомобиль"));
      carData.set(alias, {
        batteryCapacityKwh: Number(row.battery_capacity_kwh ?? 0),
        chargerPowerKw: Number(row.default_charger_power_kw ?? 4.4),
        efficiencyPercent: Number(row.default_efficiency_percent ?? 90),
      });
    }
  }

  // Profile: currency + price info (loaded once for all vehicles)
  const profileExt = await supabase
    .from("profiles")
    .select("preferred_currency, default_price_per_kwh")
    .eq("id", userId)
    .maybeSingle();
  const currency = (profileExt.data as Record<string, unknown> | null)?.preferred_currency as string ?? "EUR";

  let connected = 0;
  let parked = 0;
  let disconnected = 0;
  const fallbackCache = new Map<string, { lat: number; lon: number } | null>();
  let pricePerKwhCache: number | null = null;
  let priceCacheResolved = false;

  const now = new Date(receivedAt).getTime();

  for (const vehicleId of vehicleIds) {
    const lastSample = [...orderedSamples].reverse().find((s) => s.vehicle_id === vehicleId);
    if (!lastSample) continue;

    const prevState = states.get(vehicleId) ?? null;
    const carName = carNames.get(vehicleId) ?? "Автомобиль";
    const carInfo = carData.get(vehicleId);

    const { soc, odometer, lat: sampleLat, lon: sampleLon } = extractVehicleInfo(lastSample);
    let lat = sampleLat;
    let lon = sampleLon;

    // GPS fallback: live sample → trip track point
    if (lat == null || lon == null) {
      if (!fallbackCache.has(vehicleId)) {
        fallbackCache.set(vehicleId, await fallbackLocation(supabase, userId, vehicleId));
      }
      const fb = fallbackCache.get(vehicleId);
      if (fb) {
        lat = fb.lat;
        lon = fb.lon;
      }
    }

    const isParked = isGearP(lastSample);

    // Charging info: time to 100% + cost (computed once per call)
    const isCharging = String(lastSample.telemetry.is_charging ?? "").toLowerCase() === "true" || 
      (finiteTelemetryNumber(lastSample.telemetry.charge_power_kw) ?? 0) > 0.1;
    let chargePowerKw = finiteTelemetryNumber(lastSample.telemetry.charge_power_kw);
    if ((chargePowerKw == null || chargePowerKw <= 0) && isCharging && carInfo) {
      chargePowerKw = carInfo.chargerPowerKw;
    }
    const timeToFull = chargeTimeToFull(soc, chargePowerKw, carInfo?.batteryCapacityKwh ?? null, carInfo?.efficiencyPercent ?? null);
    if (!priceCacheResolved) {
      priceCacheResolved = true;
      if (chargePowerKw != null && chargePowerKw > 0 && soc != null && soc < 100) {
        pricePerKwhCache = await resolvePricePerKwh(supabase, userId, lat, lon, chargePowerKw);
      }
    }
    let chargeCost: number | null = null;
    if (pricePerKwhCache != null) {
      chargeCost = calcChargeCost(soc, carInfo?.batteryCapacityKwh ?? null, carInfo?.efficiencyPercent ?? null, pricePerKwhCache);
    }

    if (shouldSendTelegram) {
      console.log("vehicle state:", vehicleId, "prevState:", !!prevState, "parked:", isParked, "soc:", soc, "odo:", odometer, "gps:", lat, lon);
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
          const discoLat = prevState.last_lat ?? lat;
          const discoLon = prevState.last_lon ?? lon;
          const discText = notificationText(
            carName,
            "disconnected",
            prevState.last_odometer_km != null ? Math.round(prevState.last_odometer_km) : null,
            prevState.last_soc != null ? Math.round(prevState.last_soc) : null,
            prevState.last_device_time ?? lastSample.device_time,
            discoLat,
            discoLon,
            timeToFull,
            chargeCost,
            currency,
            chargePowerKw,
            profile.timezone,
          );
          await sendTelegramMessage(profile.telegramId, discText, { disableWebPagePreview: false });
          disconnected++;
        }
      }

      if (gapMs > CONNECTED_GAP_MS) {
        if (shouldSendTelegram && profile.telegramId != null) {
          const connText = notificationText(carName, "connected", odometer, soc, lastSample.device_time, lat, lon, timeToFull, chargeCost, currency, chargePowerKw, profile.timezone);
          await sendTelegramMessage(profile.telegramId, connText, { disableWebPagePreview: false });
          connected++;
        }
      }
    } else if (!prevState) {
      if (shouldSendTelegram && profile.telegramId != null) {
        const connText = notificationText(carName, "connected", odometer, soc, lastSample.device_time, lat, lon, timeToFull, chargeCost, currency, chargePowerKw, profile.timezone);
        await sendTelegramMessage(profile.telegramId, connText, { disableWebPagePreview: false });
        connected++;
      }
    }

    if (isParked && (!prevState || !prevState.last_is_parked)) {
      const parkCooldownOk = !prevState?.last_park_notified_at
        || now - new Date(prevState.last_park_notified_at).getTime() > PARK_NOTIFICATION_COOLDOWN_MS;

      if (parkCooldownOk && shouldSendTelegram && profile.telegramId != null) {
        const parkText = notificationText(carName, "parked", odometer, soc, lastSample.device_time, lat, lon, timeToFull, chargeCost, currency, chargePowerKw, profile.timezone);
        await sendTelegramMessage(profile.telegramId, parkText, { disableWebPagePreview: false });
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
