import type { SupabaseClient } from "@supabase/supabase-js";

import type { TelemetryPayload } from "@/lib/bydmate/ingest-payload";
import { isDriveTelemetry, isParkStateTelemetry } from "@/lib/bydmate/gear";
import { latestSampleByVehicle } from "@/lib/bydmate/latest-sample";
import { finiteTelemetryNumber, isTelemetryCharging } from "@/lib/bydmate/telemetry-charging";
import { siteUrl as canonicalSiteUrl } from "@/lib/site-url";
import { editTelegramMessageText, sendTelegramMessage } from "@/lib/telegram/bot-send";

const THROTTLE_MS = 30_000;
const SOC_BAR_LENGTH = 12;

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

function socBar(soc: number): string {
  const filled = Math.round((soc / 100) * SOC_BAR_LENGTH);
  const empty = SOC_BAR_LENGTH - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function formatHoursMinutes(totalHours: number): string {
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
): string | null {
  if (soc == null || chargePowerKw == null || batteryCapacityKwh == null || chargePowerKw <= 0 || soc >= 100) return null;
  const remainingKwh = (batteryCapacityKwh * (100 - soc)) / 100;
  return formatHoursMinutes(remainingKwh / chargePowerKw);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function chatListSummary(
  soc: number | null,
  odometer: number | null,
  state: VehicleState,
): string {
  const battery = soc != null ? `🔋 ${soc}%` : "🔋 —";
  const stateMark = state === "driving" ? "D" : state === "parked" ? "P" : state === "charging" ? "⚡" : "—";
  const mileage = odometer != null ? `${odometer.toLocaleString("ru-RU")} км` : "—";
  return `${battery} · ${stateMark} · ${mileage}`;
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
  name: string;
  battery_capacity_kwh: number;
  default_charger_power_kw: number;
};

function widgetHtml(data: {
  carName: string;
  emoji: string;
  state: VehicleState;
  stateLabel: string;
  soc: number | null;
  chargePowerKw: number | null;
  timeToFull: string | null;
  odometer: number | null;
  speedKmh: number | null;
  lat: number | null;
  lon: number | null;
}): string {
  const lines: string[] = [];
  const name = escapeHtml(data.carName);

  // Telegram's chat list previews the beginning of the latest message. Keep
  // this concise, live line first while preserving the detailed card below.
  lines.push(chatListSummary(data.soc, data.odometer, data.state));
  lines.push(`<b>${data.emoji} ${name}</b> · ${data.stateLabel}`);

  if (data.soc != null) {
    lines.push(`<code>${socBar(data.soc)}</code> <b>${data.soc}%</b>`);
  }

  const chargeParts: string[] = [];
  if (data.chargePowerKw != null && data.chargePowerKw > 0) {
    chargeParts.push(`⚡ ${data.chargePowerKw.toFixed(1)} kW`);
  }
  if (data.timeToFull) {
    chargeParts.push(`⏱ ${data.timeToFull}`);
  }
  if (chargeParts.length > 0) {
    lines.push(chargeParts.join(" · "));
  }

  const statusParts: string[] = [];
  if (data.odometer != null) {
    statusParts.push(`Пробег ${data.odometer} км`);
  }
  if (data.speedKmh != null && data.speedKmh > 0) {
    statusParts.push(`${data.speedKmh} km/h`);
  }
  if (statusParts.length > 0) {
    lines.push(`🚗 ${statusParts.join(" · ")}`);
  }

  if (data.lat != null && data.lon != null) {
    lines.push(`📍 <a href="https://www.google.com/maps?q=${data.lat},${data.lon}">Открыть карту</a>`);
  }

  return lines.join("\n");
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
    .select("name, vehicle_alias, battery_capacity_kwh, default_charger_power_kw")
    .eq("user_id", userId)
    .in("vehicle_alias", vehicleIds);

  const map = new Map<string, CarInfo>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const alias = String(row.vehicle_alias ?? "");
    if (alias) {
      map.set(alias, {
        name: String(row.name ?? "Автомобиль"),
        battery_capacity_kwh: Number(row.battery_capacity_kwh ?? 0),
        default_charger_power_kw: Number(row.default_charger_power_kw ?? 4.4),
      });
    }
  }
  return map;
}

type VehicleState = "charging" | "parked" | "driving" | "offline";

function determineState(lastSample: TelemetryPayload, nowMs: number, receivedAt: string): VehicleState {
  const receivedMs = Date.parse(receivedAt);
  if (Number.isFinite(receivedMs) && nowMs - receivedMs > 10 * 60 * 1000) {
    return "offline";
  }

  const snapshot = {
    telemetry: lastSample.telemetry,
    diplus: lastSample.diplus,
    diplus_gear: lastSample.diplus_gear as string | number | null | undefined,
  };

  if (isDriveTelemetry(snapshot)) return "driving";
  if (isTelemetryCharging(lastSample.telemetry, lastSample)) return "charging";
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

function stateLabel(state: VehicleState): string {
  switch (state) {
    case "charging": return "Зарядка";
    case "parked": return "Припаркован";
    case "driving": return "В движении";
    case "offline": return "Офлайн";
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
): Promise<boolean> {
  const replyMarkup = {
    inline_keyboard: [[
      { text: "Открыть VoltFlow", web_app: { url: webAppUrl } },
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
  samples,
  receivedAt,
}: {
  supabase: SupabaseClient;
  userId: string;
  samples: TelemetryPayload[];
  receivedAt: string;
}) {
  const vehicleIds = Array.from(new Set(samples.map((s) => s.vehicle_id)));
  if (!vehicleIds.length) return { updated: 0 };

  const orderedSamples = [...samples].sort(
    (a, b) => Date.parse(a.device_time) - Date.parse(b.device_time),
  );
  const latestSamples = latestSampleByVehicle(orderedSamples);

  const cars = await loadCars(supabase, userId, vehicleIds);
  const { data: profile } = await supabase
    .from("profiles")
    .select("telegram_id")
    .eq("id", userId)
    .maybeSingle();

  const chatId = ((profile as Record<string, unknown> | null)?.telegram_id as number | null) ?? null;
  if (chatId == null) return { updated: 0 };

  const webAppUrl = canonicalSiteUrl("/vehicle");

  const nowMs = new Date(receivedAt).getTime();
  let updated = 0;

  for (const vehicleId of vehicleIds) {
    const lastSample = latestSamples.get(vehicleId);
    if (!lastSample) continue;

    const carInfo = cars.get(vehicleId);

    const state = determineState(lastSample, nowMs, receivedAt);
    const soc = clampSoc(lastSample.telemetry.soc) ?? clampSoc(lastSample.diplus?.soc);
    const odometer = clampOdometer(lastSample.telemetry.odometer_km) ?? clampOdometer(lastSample.diplus?.mileage_km);
    const speedKmh = clampSpeed(lastSample.telemetry.speed_kmh);
    const lat = finiteTelemetryNumber(lastSample.location?.lat);
    const lon = finiteTelemetryNumber(lastSample.location?.lon);

    let chargePowerKw = finiteTelemetryNumber(lastSample.telemetry.charge_power_kw);
    if ((chargePowerKw == null || chargePowerKw <= 0) && state === "charging" && carInfo) {
      chargePowerKw = carInfo.default_charger_power_kw;
    }

    const timeToFull = chargeTimeToFull(soc, chargePowerKw, carInfo?.battery_capacity_kwh ?? null);

    const html = widgetHtml({
      carName: carInfo?.name ?? "Автомобиль",
      emoji: stateEmoji(state),
      state,
      stateLabel: stateLabel(state),
      soc,
      chargePowerKw,
      timeToFull,
      odometer,
      speedKmh,
      lat,
      lon,
    });

    const existing = await loadWidgetRow(supabase, userId, vehicleId);

    if (existing && existing.status === "active") {
      const lastEditMs = Date.parse(existing.updated_at);
      if (Number.isFinite(lastEditMs) && nowMs - lastEditMs < THROTTLE_MS) {
        continue;
      }
    }

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
    );
    if (ok) updated++;
  }

  return { updated };
}
