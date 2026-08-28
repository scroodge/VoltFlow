import { translate, type Locale } from "../i18n.ts";

// Driving and charging both move SOC materially; parked/offline cars can safely retain
// an overnight estimate, but it still expires after a day to bound phantom-drain error.
export const TELEGRAM_LIVE_RANGE_ACTIVE_MAX_AGE_MS = 10 * 60 * 1000;
export const TELEGRAM_LIVE_RANGE_PARKED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SOC_BAR_LENGTH = 12;

export type TelegramLiveVehicleState = "charging" | "parked" | "driving" | "offline";

export type TelegramLiveWidgetMessage = {
  carName: string;
  emoji: string;
  state: TelegramLiveVehicleState;
  locale: Locale;
  soc: number | null;
  estimatedRangeKm: number | null;
  rangeSampleTime: string;
  nowMs: number;
  chargePowerKw: number | null;
  timeToFull: string | null;
  odometer: number | null;
  speedKmh: number | null;
  lat: number | null;
  lon: number | null;
};

function socBar(soc: number): string {
  const filled = Math.round((soc / 100) * SOC_BAR_LENGTH);
  return "█".repeat(filled) + "░".repeat(SOC_BAR_LENGTH - filled);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function freshRangeEstimateKm(
  value: number | null,
  sampleTime: string,
  nowMs: number,
  state: TelegramLiveVehicleState,
): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const sampleMs = Date.parse(sampleTime);
  const maxAgeMs =
    state === "parked" || state === "offline"
      ? TELEGRAM_LIVE_RANGE_PARKED_MAX_AGE_MS
      : TELEGRAM_LIVE_RANGE_ACTIVE_MAX_AGE_MS;
  if (!Number.isFinite(sampleMs) || nowMs - sampleMs > maxAgeMs) {
    return null;
  }
  return Math.round(value);
}

function stateMark(state: TelegramLiveVehicleState): string {
  if (state === "driving") return "D";
  if (state === "parked") return "P";
  if (state === "charging") return "⚡";
  return "—";
}

function stateLabel(locale: Locale, state: TelegramLiveVehicleState): string {
  return translate(locale, `telegramLiveWidget.state.${state}`) as string;
}

export function composeTelegramLiveWidget(data: TelegramLiveWidgetMessage): string {
  const lines: string[] = [];
  const battery = data.soc != null ? `🔋 ${data.soc}%` : "🔋 —";
  const rangeKm = freshRangeEstimateKm(
    data.estimatedRangeKm,
    data.rangeSampleTime,
    data.nowMs,
    data.state,
  );
  const summary = [battery, stateMark(data.state)];
  if (rangeKm != null) summary.push(`≈ ${rangeKm.toLocaleString(data.locale)} km`);
  lines.push(summary.join(" · "));

  lines.push(`<b>${data.emoji} ${escapeHtml(data.carName)}</b> · ${stateLabel(data.locale, data.state)}`);

  if (data.soc != null) {
    lines.push(`<code>${socBar(data.soc)}</code> <b>${data.soc}%</b>`);
  }

  const chargeParts: string[] = [];
  if (data.chargePowerKw != null && data.chargePowerKw > 0) {
    chargeParts.push(`⚡ ${data.chargePowerKw.toFixed(1)} kW`);
  }
  if (data.timeToFull) chargeParts.push(`⏱ ${data.timeToFull}`);
  if (chargeParts.length > 0) lines.push(chargeParts.join(" · "));

  const statusParts: string[] = [];
  if (data.odometer != null) {
    statusParts.push(translate(data.locale, "telegramLiveWidget.mileage", { value: data.odometer }) as string);
  }
  if (data.speedKmh != null && data.speedKmh > 0) statusParts.push(`${data.speedKmh} km/h`);
  if (statusParts.length > 0) lines.push(`🚗 ${statusParts.join(" · ")}`);

  if (data.lat != null && data.lon != null) {
    const mapLabel = translate(data.locale, "telegramLiveWidget.openMap") as string;
    lines.push(`📍 <a href="https://www.google.com/maps?q=${data.lat},${data.lon}">${mapLabel}</a>`);
  }

  return lines.join("\n");
}
