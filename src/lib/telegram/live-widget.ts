import type { SupabaseClient } from "@supabase/supabase-js";

import type { TelemetryPayload } from "@/lib/voltflowmate/ingest-payload";
import {
  isDriveTelemetry,
  isParkStateTelemetry,
} from "@/lib/voltflowmate/gear";
import { latestSampleByVehicle } from "@/lib/voltflowmate/latest-sample";
import {
  finiteTelemetryNumber,
  measuredChargePowerKw,
} from "@/features/charging/domain";
import { siteUrl as canonicalSiteUrl } from "@/lib/site-url";
import {
  editTelegramMessageText,
  sendTelegramMessage,
} from "@/lib/telegram/bot-send";
import {
  newestActiveSessionByCar,
  resolveTelegramChargingMetrics,
  type TelegramActiveChargingSession,
} from "@/lib/telegram/live-widget-charging";
import { isChargingTelemetry } from "@/lib/vehicle-live-mode";
import { translate, type Locale } from "@/lib/i18n";
import {
  composeTelegramLiveWidget,
  staleDataTimeLabel,
  telegramLiveWidgetReplyMarkup,
  type TelegramLiveVehicleState,
} from "@/lib/telegram/live-widget-message";
import {
  isTelegramLiveWidgetEditDue,
  isTelegramLiveWidgetRegression,
  TELEGRAM_LIVE_WIDGET_STALE_MS,
} from "@/lib/telegram/live-widget-edit-due";
import { resolveLatestMateVersion } from "@/lib/mate-latest-release";
import { estimateVehicleRangeKm } from "@/lib/voltflowmate/range-estimate";
import {
  cleanTrips,
  selectTripsWithinDistanceWindow,
} from "@/lib/voltflowmate/hero-drive-metrics";
import type { VoltflowMateTripRow } from "@/types/database";

function clampSoc(value: unknown): number | null {
  const n = finiteTelemetryNumber(value);
  return n != null && n >= 0 && n <= 100 ? n : null;
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
    return translate(locale, "telegramLiveWidget.timeHoursMinutes", {
      hours: h,
      minutes: m,
    }) as string;
  }
  if (h > 0) {
    return translate(locale, "telegramLiveWidget.timeHours", {
      hours: h,
    }) as string;
  }
  return translate(locale, "telegramLiveWidget.timeMinutes", {
    minutes: m,
  }) as string;
}

type LiveWidgetRow = {
  user_id: string;
  vehicle_id: string;
  chat_id: number;
  message_id: number;
  status: string;
  updated_at: string;
  last_state: string | null;
  rendered_device_time: string | null;
};

type CarInfo = {
  id: string;
  name: string;
  battery_capacity_kwh: number;
  default_charger_power_kw: number;
  range_reserve_soc_percent: number;
};

async function loadWidgetRow(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
): Promise<LiveWidgetRow | null> {
  const { data } = await supabase
    .from("telegram_live_messages")
    .select(
      "user_id,vehicle_id,chat_id,message_id,status,updated_at,last_state,rendered_device_time",
    )
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
  state: VehicleState,
  renderedDeviceTime: string,
) {
  await supabase.from("telegram_live_messages").upsert(
    {
      user_id: userId,
      vehicle_id: vehicleId,
      chat_id: chatId,
      message_id: messageId,
      status: "active",
      updated_at: new Date().toISOString(),
      last_state: state,
      rendered_device_time: renderedDeviceTime,
    },
    { onConflict: "user_id,vehicle_id" },
  );
}

async function touchUpdatedAt(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
  state: VehicleState,
  renderedDeviceTime: string,
) {
  await supabase
    .from("telegram_live_messages")
    .update({
      updated_at: new Date().toISOString(),
      last_state: state,
      rendered_device_time: renderedDeviceTime,
    })
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
    .select(
      "id, name, vehicle_alias, battery_capacity_kwh, default_charger_power_kw, range_reserve_soc_percent",
    )
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
        range_reserve_soc_percent: Number(row.range_reserve_soc_percent ?? 0),
      });
    }
  }
  return map;
}

async function loadRecentTrips(
  supabase: SupabaseClient,
  userId: string,
  vehicleId: string,
): Promise<VoltflowMateTripRow[]> {
  const { data, error } = await supabase
    .from("bydmate_trips")
    .select(
      "id,user_id,vehicle_id,started_at,ended_at,last_device_time,sample_count,track_point_count,distance_km,soc_start,soc_end,max_speed_kmh,avg_speed_kmh,avg_consumption_kwh_100km,regen_energy_kwh,traction_energy_kwh,source",
    )
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .order("started_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("telegram live widget recent trips:", error.message);
    return [];
  }
  return (data ?? []) as VoltflowMateTripRow[];
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

// Only read when the shown data is stale (an offline queue flush), so a normal ingest pays
// no extra query. Every profile in prod is Europe/Minsk today; the fallback matches that.
async function loadProfileTimeZone(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  const zone = (data as { timezone?: string | null } | null)?.timezone?.trim();
  return zone || "Europe/Minsk";
}

type VehicleState = TelegramLiveVehicleState;

function determineState(
  lastSample: TelemetryPayload,
  nowMs: number,
  receivedAt: string,
): VehicleState {
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
    case "charging":
      return "🔌";
    case "parked":
      return "🚗";
    case "driving":
      return "🚗";
    case "offline":
      return "💤";
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
  state: VehicleState,
  renderedDeviceTime: string,
): Promise<boolean> {
  const replyMarkup = telegramLiveWidgetReplyMarkup(locale, webAppUrl);

  if (existingMessageId != null && chatId != null) {
    const result = await editTelegramMessageText(
      chatId,
      existingMessageId,
      html,
      {
        parseMode: "HTML",
        replyMarkup,
      },
    );
    if (result.ok) {
      await touchUpdatedAt(supabase, userId, vehicleId, state, renderedDeviceTime);
      return true;
    }
    // The tracked message may have been deleted client-side (cleared chat
    // history). Recreate the widget instead of editing a ghost every ingest.
    if (!/not found|isn't accessible/i.test(result.error)) return false;
  }

  const result = await sendTelegramMessage(chatId ?? 0, html, {
    parseMode: "HTML",
    replyMarkup,
  });
  if (!result.ok || result.messageId == null) return false;

  await upsertWidgetRow(
    supabase,
    userId,
    vehicleId,
    chatId ?? 0,
    result.messageId,
    state,
    renderedDeviceTime,
  );
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
      vehicleIds.map(
        async (vehicleId) =>
          [
            vehicleId,
            await loadWidgetRow(supabase, userId, vehicleId),
          ] as const,
      ),
    ),
  );
  const stateByVehicle = new Map<string, VehicleState>();
  for (const [vehicleId, sample] of latestSamples) {
    stateByVehicle.set(vehicleId, determineState(sample, nowMs, receivedAt));
  }
  const eligibleVehicleIds = vehicleIds.filter((vehicleId) => {
    const row = existingByVehicle.get(vehicleId) ?? null;
    // Hide-button opt-out: a hidden widget is never resurrected by ingest.
    if (row?.status === "hidden") return false;
    // A replayed offline queue must not walk the widget back to older state.
    const latest = latestSamples.get(vehicleId);
    if (latest && isTelegramLiveWidgetRegression(row, latest.device_time))
      return false;
    const state = stateByVehicle.get(vehicleId);
    return state != null && isTelegramLiveWidgetEditDue(row, nowMs, state);
  });
  if (!eligibleVehicleIds.length) return { updated: 0 };

  const cars = await loadCars(supabase, userId, eligibleVehicleIds);
  const activeSessions = await loadActiveChargingSessions(
    supabase,
    userId,
    Array.from(cars.values(), (car) => car.id).filter(Boolean),
  );
  // One release lookup per ingest, only once some widget is due for an edit. GitHub is
  // fetch-cached for 5 min, so this is not a per-sample network call.
  const latestMateVersionPromise = resolveLatestMateVersion(supabase);
  const recentTripsByVehicle = new Map(
    await Promise.all(
      eligibleVehicleIds.map(
        async (vehicleId) =>
          [
            vehicleId,
            await loadRecentTrips(supabase, userId, vehicleId),
          ] as const,
      ),
    ),
  );
  const latestMateVersion = await latestMateVersionPromise;
  let updated = 0;

  for (const vehicleId of eligibleVehicleIds) {
    const lastSample = latestSamples.get(vehicleId);
    const state = stateByVehicle.get(vehicleId);
    if (!lastSample || !state) continue;

    const carInfo = cars.get(vehicleId);

    const soc =
      clampSoc(lastSample.telemetry.soc) ?? clampSoc(lastSample.diplus?.soc);
    const odometer =
      clampOdometer(lastSample.telemetry.odometer_km) ??
      clampOdometer(lastSample.diplus?.mileage_km);
    const speedKmh = clampSpeed(lastSample.telemetry.speed_kmh);
    const lat = finiteTelemetryNumber(lastSample.location?.lat);
    const lon = finiteTelemetryNumber(lastSample.location?.lon);

    const rawChargePowerKw = finiteTelemetryNumber(
      lastSample.telemetry.charge_power_kw,
    );
    // A measured pack V × I reading (negative charge_current_a) is shown as is, with two
    // decimals. It is battery-side, so the time-to-full converts it to grid-side first.
    const measuredPowerKw =
      state === "charging" ? measuredChargePowerKw(lastSample.telemetry) : null;
    const chargingMetrics = resolveTelegramChargingMetrics({
      soc,
      rawChargePowerKw,
      defaultChargePowerKw:
        state === "charging"
          ? (carInfo?.default_charger_power_kw ?? null)
          : null,
      batteryCapacityKwh: carInfo?.battery_capacity_kwh ?? null,
      chargeType: lastSample.telemetry.charge_type,
      session:
        state === "charging" && carInfo
          ? (activeSessions.get(carInfo.id) ?? null)
          : null,
      nowMs,
      measuredLivePowerKw: measuredPowerKw,
    });
    const chargePowerKw = measuredPowerKw ?? chargingMetrics.chargePowerKw;
    const timeToFull =
      chargingMetrics.timeToFullHours != null
        ? formatHoursMinutes(chargingMetrics.timeToFullHours, profileLocale)
        : null;

    const capacityKwh = carInfo?.battery_capacity_kwh;
    const recentTrips = selectTripsWithinDistanceWindow(
      cleanTrips(recentTripsByVehicle.get(vehicleId) ?? []),
    );
    const estimatedRangeKm =
      capacityKwh != null && Number.isFinite(capacityKwh) && capacityKwh > 0
        ? estimateVehicleRangeKm(lastSample, recentTrips, {
            batteryCapacityKwh: capacityKwh,
            reserveSocPercent: carInfo?.range_reserve_soc_percent ?? 0,
          }).estimatedRangeKm
        : null;

    const html = composeTelegramLiveWidget({
      carName:
        carInfo?.name ??
        (translate(profileLocale, "telegramLiveWidget.vehicle") as string),
      emoji: stateEmoji(state),
      state,
      locale: profileLocale,
      soc,
      estimatedRangeKm,
      reserveSocPercent: carInfo?.range_reserve_soc_percent ?? 0,
      rangeSampleTime: lastSample.device_time,
      nowMs,
      chargePowerKw,
      chargePowerMeasured: measuredPowerKw != null,
      timeToFull,
      odometer,
      speedKmh,
      lat,
      lon,
      mateVersion: lastSample.mate_version ?? null,
      latestMateVersion,
      dataTimeLabel:
        nowMs - Date.parse(lastSample.device_time) > TELEGRAM_LIVE_WIDGET_STALE_MS
          ? staleDataTimeLabel(
              lastSample.device_time,
              nowMs,
              profileLocale,
              await loadProfileTimeZone(supabase, userId),
              TELEGRAM_LIVE_WIDGET_STALE_MS,
            )
          : null,
    });

    const existing = existingByVehicle.get(vehicleId) ?? null;

    // Car was offline (>10 min) and is now back — send a new message
    const useExistingMessageId =
      existing?.status === "active" ? existing.message_id : null;

    const ok = await sendOrEditWidget(
      supabase,
      userId,
      vehicleId,
      chatId,
      useExistingMessageId,
      html,
      webAppUrl,
      profileLocale,
      state,
      lastSample.device_time,
    );
    if (ok) updated++;
  }

  return { updated };
}
