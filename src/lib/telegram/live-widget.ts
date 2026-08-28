import type { SupabaseClient } from "@supabase/supabase-js";

import type { TelemetryPayload } from "@/lib/voltflowmate/ingest-payload";
import { isDriveTelemetry, isParkStateTelemetry } from "@/lib/voltflowmate/gear";
import { latestSampleByVehicle } from "@/lib/voltflowmate/latest-sample";
import { finiteTelemetryNumber } from "@/features/charging/domain";
import { siteUrl as canonicalSiteUrl } from "@/lib/site-url";
import { editTelegramMessageText, sendTelegramMessage } from "@/lib/telegram/bot-send";
import {
  newestActiveSessionByCar,
  resolveTelegramChargingMetrics,
  type TelegramActiveChargingSession,
} from "@/lib/telegram/live-widget-charging";
import { isChargingTelemetry } from "@/lib/vehicle-live-mode";
import { translate, type Locale } from "@/lib/i18n";
import {
  composeTelegramLiveWidget,
  type TelegramLiveVehicleState,
} from "@/lib/telegram/live-widget-message";

const THROTTLE_MS = 30_000;

function clampSoc(value: unknown): number | null {
  const n = finiteTelemetryNumber(value);
  return n != null && n >= 0 && n <= 100 ? Math.round(n) : null;
}

function clampOdometer(value: unknown): number | null {
  const n = finiteTelemetryNumber(value);
  return n != null && n >= 0 ? Math.round(n) : null;
}

function clampSpeed(value: unknown): number | null {
  const n = finiteTelemetryNumber(value);
  return n != null && n >= 0 ? Math.round(n) : null;
}

function formatHoursMinutes(totalHours: number, locale: Locale): string {
  if (totalHours <= 0 || !Number.isFinite(totalHours)) return "";
  const h = Math.floor(totalHours);
  const m = Math.round((totalHours - h) * 60);
  if (h > 0 && m > 0) {
    return translate(locale, "telegramLiveWidget.timeHoursMinutes", { hours: h, minutes: m }) as string;
  }
  if (h > 0) {
    return translate(locale, "telegramLiveWidget.timeHours", { hours: h }) as string;
  }
  return translate(locale, "telegramLiveWidget.timeMinutes", { minutes: m }) as string;
}

type LiveWidgetRow = {
  user_id: string;
  vehicle_id: string;
  chat_id: number;
  message_id: number;
  status: string;
  updated_at: string;
};

type CarInfo = {
  id: string;
  name: string;
  battery_capacity_kwh: number;
  default_charger_power_kw: number;
};

function isWidgetEditDue(existing: LiveWidgetRow | null, nowMs: number) {
  if (!existing || existing.status !== "active") return true;
  const lastEditMs = Date.parse(existing.updated_at);
  return !Number.isFinite(lastEditMs) || nowMs - lastEditMs >= THROTTLE_MS;
}

async function loadWidgetRow(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
): Promise<LiveWidgetRow | null> {
  const { data } = await supabase
    .from("telegram_live_messages")
    .select("user_id,vehicle_id,chat_id,message_id,status,updated_at")
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .maybeSingle();

  return data as LiveWidgetRow | null;
}

async function upsertWidgetRow(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
  chatId: number,
  messageId: number,
) {
  await supabase.from("telegram_live_messages").upsert(
    {
      user_id: userId,
      vehicle_id: vehicleId,
      chat_id: chatId,
      message_id: messageId,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,vehicle_id" },
  );
}

async function touchUpdatedAt(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
) {
  await supabase
    .from("telegram_live_messages")
    .update({ updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId);
}

async function loadCars(
  supabase: SupabaseClient,
  userId: string,
  vehicleIds: string[],
): Promise<Map<string, CarInfo>> {
  const { data } = await supabase
    .from("cars")
    .select("id, name, vehicle_alias, battery_capacity_kwh, default_charger_power_kw")
    .eq("user_id", userId)
    .in("vehicle_alias", vehicleIds);

  const map = new Map<string, CarInfo>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const alias = String(row.vehicle_alias ?? "");
    if (alias) {
      map.set(alias, {
        id: String(row.id ?? ""),
        name: String(row.name ?? "Автомобиль"),
        battery_capacity_kwh: Number(row.battery_capacity_kwh ?? 0),
        default_charger_power_kw: Number(row.default_charger_power_kw ?? 4.4),
      });
    }
  }
  return map;
}

async function loadActiveChargingSessions(
  supabase: SupabaseClient,
  userId: string,
  carIds: string[],
): Promise<Map<string, TelegramActiveChargingSession>> {
  if (!carIds.length) return new Map();

  const { data, error } = await supabase
    .from("charging_sessions")
    .select(
      "car_id,start_percent,target_percent,battery_capacity_kwh,efficiency_percent,tariff_type,started_at,created_at",
    )
    .eq("user_id", userId)
    .eq("status", "charging")
    .in("car_id", carIds)
    .order("started_at", { ascending: false });

  if (error) {
    console.error("telegram live widget charging sessions:", error.message);
    return new Map();
  }

  const sessions = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    car_id: String(row.car_id ?? ""),
    start_percent: Number(row.start_percent ?? 0),
    target_percent: Number(row.target_percent ?? 100),
    battery_capacity_kwh: Number(row.battery_capacity_kwh ?? 0),
    efficiency_percent: Number(row.efficiency_percent ?? 100),
    tariff_type: String(row.tariff_type ?? "home"),
    started_at: typeof row.started_at === "string" ? row.started_at : null,
    created_at: String(row.created_at ?? ""),
  }));
  return newestActiveSessionByCar(sessions);
}

type VehicleState = TelegramLiveVehicleState;

function determineState(lastSample: TelemetryPayload, nowMs: number, receivedAt: string): VehicleState {
  const receivedMs = Date.parse(receivedAt);
  if (Number.isFinite(receivedMs) && nowMs - receivedMs > 10 * 60 * 1000) {
    return "offline";
  }

  const snapshot = {
    telemetry: lastSample.telemetry,
    diplus: lastSample.diplus,
    diplus_gear: lastSample.diplus?.gear,
  };

  // Charging must be checked before gear: some cars' DiPlus gear signal doesn't reset
  // to "P" while parked and charging, so a raw gear-first check misreports "driving".
  if (isChargingTelemetry(snapshot)) return "charging";
  if (isDriveTelemetry(snapshot)) return "driving";
  if (isParkStateTelemetry(snapshot)) return "parked";
  return "offline";
}

function stateEmoji(state: VehicleState): string {
  switch (state) {
    case "charging": return "🔌";
    case "parked": return "🚗";
    case "driving": return "🚗";
    case "offline": return "💤";
  }
}

async function sendOrEditWidget(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
  chatId: number | null,
  existingMessageId: number | null,
  html: string,
  webAppUrl: string,
  locale: Locale,
): Promise<boolean> {
  const replyMarkup = {
    inline_keyboard: [[
      { text: translate(locale, "telegramLiveWidget.openVoltFlow") as string, web_app: { url: webAppUrl } },
    ]],
  };

  if (existingMessageId != null && chatId != null) {
    const result = await editTelegramMessageText(chatId, existingMessageId, html, {
      parseMode: "HTML",
      replyMarkup,
    });
    if (result.ok) {
      await touchUpdatedAt(supabase, userId, vehicleId);
      return true;
    }
    return false;
  }

  const result = await sendTelegramMessage(chatId ?? 0, html, {
    parseMode: "HTML",
    replyMarkup,
  });
  if (!result.ok || result.messageId == null) return false;

  await upsertWidgetRow(supabase, userId, vehicleId, chatId ?? 0, result.messageId);
  return true;
}

export async function updateTelegramLiveWidgets({
  supabase,
  userId,
  telegramId,
  profileLocale,
  samples,
  receivedAt,
}: {
  supabase: SupabaseClient;
  userId: string;
  telegramId: number | null;
  profileLocale: Locale;
  samples: TelemetryPayload[];
  receivedAt: string;
}) {
  const vehicleIds = Array.from(new Set(samples.map((s) => s.vehicle_id)));
  if (!vehicleIds.length) return { updated: 0 };

  const orderedSamples = [...samples].sort(
    (a, b) => Date.parse(a.device_time) - Date.parse(b.device_time),
  );
  const latestSamples = latestSampleByVehicle(orderedSamples);

  // The API-key profile lookup already loaded this server-only eligibility field. A user
  // without Telegram therefore avoids another profiles query on every telemetry ingest.
  if (telegramId == null) return { updated: 0 };
  const chatId = telegramId;

  const webAppUrl = canonicalSiteUrl("/vehicle");

  const nowMs = new Date(receivedAt).getTime();
  const existingByVehicle = new Map(
    await Promise.all(
      vehicleIds.map(async (vehicleId) => [
        vehicleId,
        await loadWidgetRow(supabase, userId, vehicleId),
      ] as const),
    ),
  );
  const eligibleVehicleIds = vehicleIds.filter((vehicleId) =>
    isWidgetEditDue(existingByVehicle.get(vehicleId) ?? null, nowMs),
  );
  if (!eligibleVehicleIds.length) return { updated: 0 };

  const cars = await loadCars(supabase, userId, eligibleVehicleIds);
  const activeSessions = await loadActiveChargingSessions(
    supabase,
    userId,
    Array.from(cars.values(), (car) => car.id).filter(Boolean),
  );
  let updated = 0;

  for (const vehicleId of eligibleVehicleIds) {
    const lastSample = latestSamples.get(vehicleId);
    if (!lastSample) continue;

    const carInfo = cars.get(vehicleId);

    const state = determineState(lastSample, nowMs, receivedAt);
    const soc = clampSoc(lastSample.telemetry.soc) ?? clampSoc(lastSample.diplus?.soc);
    const odometer = clampOdometer(lastSample.telemetry.odometer_km) ?? clampOdometer(lastSample.diplus?.mileage_km);
    const speedKmh = clampSpeed(lastSample.telemetry.speed_kmh);
    const lat = finiteTelemetryNumber(lastSample.location?.lat);
    const lon = finiteTelemetryNumber(lastSample.location?.lon);

    const rawChargePowerKw = finiteTelemetryNumber(lastSample.telemetry.charge_power_kw);
    const chargingMetrics = resolveTelegramChargingMetrics({
      soc,
      rawChargePowerKw,
      defaultChargePowerKw:
        state === "charging" ? (carInfo?.default_charger_power_kw ?? null) : null,
      batteryCapacityKwh: carInfo?.battery_capacity_kwh ?? null,
      chargeType: lastSample.telemetry.charge_type,
      session:
        state === "charging" && carInfo ? (activeSessions.get(carInfo.id) ?? null) : null,
      nowMs,
    });
    const chargePowerKw = chargingMetrics.chargePowerKw;
    const timeToFull =
      chargingMetrics.timeToFullHours != null
        ? formatHoursMinutes(chargingMetrics.timeToFullHours, profileLocale)
        : null;

    const html = composeTelegramLiveWidget({
      carName: carInfo?.name ?? (translate(profileLocale, "telegramLiveWidget.vehicle") as string),
      emoji: stateEmoji(state),
      state,
      locale: profileLocale,
      soc,
      rangeEstKm: finiteTelemetryNumber(lastSample.telemetry.range_est_km),
      rangeSampleTime: lastSample.device_time,
      nowMs,
      chargePowerKw,
      timeToFull,
      odometer,
      speedKmh,
      lat,
      lon,
    });

    const existing = existingByVehicle.get(vehicleId) ?? null;

    // Car was offline (>10 min) and is now back — send a new message
    const useExistingMessageId = existing?.status === "active" ? existing.message_id : null;

    const ok = await sendOrEditWidget(
      supabase,
      userId,
      vehicleId,
      chatId,
      useExistingMessageId,
      html,
      webAppUrl,
      profileLocale,
    );
    if (ok) updated++;
  }

  return { updated };
}
