import { translate, type Locale } from "../i18n.ts";
import { formatSocPercent } from "../format-soc-percent.ts";
import { isMateUpdateAvailable } from "../mate-version.ts";

// Driving and charging both move SOC materially; parked/offline cars can safely retain
// an overnight estimate, but it still expires after a day to bound phantom-drain error.
export const TELEGRAM_LIVE_RANGE_ACTIVE_MAX_AGE_MS = 10 * 60 * 1000;
export const TELEGRAM_LIVE_RANGE_PARKED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SOC_BAR_LENGTH = 12;

export type TelegramLiveVehicleState =
  "charging" | "parked" | "driving" | "offline";

export type TelegramLiveWidgetMessage = {
  carName: string;
  emoji: string;
  state: TelegramLiveVehicleState;
  locale: Locale;
  soc: number | null;
  estimatedRangeKm: number | null;
  /** Range-reserve SOC the estimate is computed down to; shown after the km value when > 0. */
  reserveSocPercent?: number;
  rangeSampleTime: string;
  nowMs: number;
  chargePowerKw: number | null;
  /** True when `chargePowerKw` is a measured pack V × I reading (±0.03 kW): shown with 2 decimals. */
  chargePowerMeasured?: boolean;
  timeToFull: string | null;
  odometer: number | null;
  speedKmh: number | null;
  lat: number | null;
  lon: number | null;
  /** VoltFlow Mate build reported by the car (`mate_version`); null hides the footer. */
  mateVersion?: string | null;
  /** Latest published Mate release; null means unknown — never "up to date". */
  latestMateVersion?: string | null;
  /** When the shown data is stale, its sample time (see `staleDataTimeLabel`); null hides the line. */
  dataTimeLabel?: string | null;
};

/**
 * Absolute time of a stale sample ("12:19", or "20 окт., 12:19" on another day). Absolute,
 * not "27 min ago": a Telegram message is not re-rendered on its own, so a relative age
 * would be wrong a minute later. Fresh data (≤ `staleAfterMs`) returns null.
 */
export function staleDataTimeLabel(
  sampleTime: string,
  nowMs: number,
  locale: Locale,
  timeZone: string,
  staleAfterMs: number,
): string | null {
  const sampleMs = Date.parse(sampleTime);
  if (!Number.isFinite(sampleMs) || nowMs - sampleMs <= staleAfterMs)
    return null;
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat(locale, { timeZone: zone });
  } catch {
    zone = "Europe/Minsk";
  }
  const day = (ms: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(ms);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(sampleMs);
  if (day(sampleMs) === day(nowMs)) return time;
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    day: "numeric",
    month: "short",
  }).format(sampleMs);
  return `${date}, ${time}`;
}

function socBar(soc: number): string {
  const filled = Math.round((soc / 100) * SOC_BAR_LENGTH);
  return "█".repeat(filled) + "░".repeat(SOC_BAR_LENGTH - filled);
}

/**
 * Widget keyboard: open-app button + hide button. The hide callback carries no
 * vehicle id — the widget row is looked up by the callback message's own
 * (chat_id, message_id), which stays inside Telegram's 64-byte callback_data cap.
 */
export function telegramLiveWidgetReplyMarkup(
  locale: Locale,
  webAppUrl: string,
) {
  return {
    inline_keyboard: [
      [
        {
          text: translate(locale, "telegramLiveWidget.openVoltFlow") as string,
          web_app: { url: webAppUrl },
        },
      ],
      [
        {
          text: translate(locale, "telegramLiveWidget.hideWidget") as string,
          callback_data: "lw:hide",
        },
      ],
    ],
  };
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

export function composeTelegramLiveWidget(
  data: TelegramLiveWidgetMessage,
): string {
  const lines: string[] = [];
  const battery =
    data.soc != null ? `🔋 ${formatSocPercent(data.soc)}%` : "🔋 —";
  const rangeKm = freshRangeEstimateKm(
    data.estimatedRangeKm,
    data.rangeSampleTime,
    data.nowMs,
    data.state,
  );
  const summary = [battery, stateMark(data.state)];
  if (rangeKm != null) {
    const reserve = data.reserveSocPercent ?? 0;
    const reserveSuffix = reserve > 0 ? ` (${reserve}%)` : "";
    summary.push(`≈ ${rangeKm.toLocaleString(data.locale)} km${reserveSuffix}`);
  }
  lines.push(summary.join(" · "));

  lines.push(
    `<b>${data.emoji} ${escapeHtml(data.carName)}</b> · ${stateLabel(data.locale, data.state)}`,
  );

  if (data.dataTimeLabel) {
    lines.push(
      translate(data.locale, "telegramLiveWidget.dataAsOf", {
        time: escapeHtml(data.dataTimeLabel),
      }) as string,
    );
  }

  if (data.soc != null) {
    lines.push(
      `<code>${socBar(data.soc)}</code> <b>${formatSocPercent(data.soc)}%</b>`,
    );
  }

  const chargeParts: string[] = [];
  if (data.chargePowerKw != null && data.chargePowerKw > 0) {
    chargeParts.push(
      `⚡ ${data.chargePowerKw.toFixed(data.chargePowerMeasured ? 2 : 1)} kW`,
    );
  }
  if (data.timeToFull) chargeParts.push(`⏱ ${data.timeToFull}`);
  if (chargeParts.length > 0) lines.push(chargeParts.join(" · "));

  const statusParts: string[] = [];
  if (data.odometer != null) {
    statusParts.push(
      translate(data.locale, "telegramLiveWidget.mileage", {
        value: data.odometer,
      }) as string,
    );
  }
  if (data.speedKmh != null && data.speedKmh > 0)
    statusParts.push(`${data.speedKmh} km/h`);
  if (statusParts.length > 0) lines.push(`🚗 ${statusParts.join(" · ")}`);

  if (data.lat != null && data.lon != null) {
    const mapLabel = translate(
      data.locale,
      "telegramLiveWidget.openMap",
    ) as string;
    lines.push(
      `📍 <a href="https://www.google.com/maps?q=${data.lat},${data.lon}">${mapLabel}</a>`,
    );
  }

  const mateFooter = mateVersionFooter(data);
  if (mateFooter) lines.push(mateFooter);

  return lines.join("\n");
}

/**
 * Last widget line: the installed Mate APK build, or an update warning when a newer
 * release is published. No installed version → no line, so there is never a false nag.
 */
export function mateVersionFooter(
  data: Pick<
    TelegramLiveWidgetMessage,
    "locale" | "mateVersion" | "latestMateVersion"
  >,
): string | null {
  const installed = data.mateVersion?.trim();
  if (!installed) return null;
  const latest = data.latestMateVersion?.trim() ?? null;
  if (isMateUpdateAvailable(installed, latest)) {
    return translate(data.locale, "telegramLiveWidget.mateUpdateAvailable", {
      installed: escapeHtml(installed),
      latest: escapeHtml(latest ?? ""),
    }) as string;
  }
  return translate(data.locale, "telegramLiveWidget.mateVersion", {
    version: escapeHtml(installed),
  }) as string;
}
