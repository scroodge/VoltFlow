import type { AuxBatteryChemistry } from "../vehicle/aux-battery-chemistry.ts";
import { AUX_BATTERY_ALERT_THRESHOLDS } from "../vehicle/aux-battery-chemistry.ts";
import { computeAuxVoltageBaseline } from "./aux-voltage-baseline.ts";
import type { AuxVoltageDailyPoint } from "./aux-voltage-history.ts";

export const AUX_ALERT_RECOVERY_MARGIN_V = 0.2;
export const AUX_DECLINE_FROM_BASELINE_V = 0.2;
export const AUX_DECLINE_LOOKBACK_DAYS = 7;
export const AUX_DECLINE_OVER_LOOKBACK_V = 0.1;

export type AuxBatteryAlertState = {
  acuteEpisodeActive: boolean;
  lastDigestAt: string | null;
};

export type AuxBatteryAlertDecision = {
  sendAcute: boolean;
  sendDigest: boolean;
  nextState: AuxBatteryAlertState;
  latestVoltage: number | null;
  baseline: number | null;
};

function restingPoints(points: readonly AuxVoltageDailyPoint[]) {
  return points
    .filter((point): point is AuxVoltageDailyPoint & { vResting: number } =>
      point.vResting != null && Number.isFinite(point.vResting))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function isSameUtcWeek(a: string, b: string) {
  const weekStart = (value: string) => {
    const date = new Date(value);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    return date.toISOString().slice(0, 10);
  };
  return weekStart(a) === weekStart(b);
}

export function evaluateAuxBatteryAlerts({
  points,
  chemistry,
  state,
  now,
}: {
  points: readonly AuxVoltageDailyPoint[];
  chemistry: AuxBatteryChemistry;
  state: AuxBatteryAlertState;
  now: string;
}): AuxBatteryAlertDecision {
  const resting = restingPoints(points);
  const latest = resting.at(-1) ?? null;
  const threshold = AUX_BATTERY_ALERT_THRESHOLDS[chemistry];
  let episodeActive = state.acuteEpisodeActive;
  let sendAcute = false;

  if (threshold != null) {
    const lastTwo = resting.slice(-2);
    const twoConsecutiveCalendarDays = lastTwo.length === 2 &&
      Date.parse(`${lastTwo[1].date}T00:00:00Z`) - Date.parse(`${lastTwo[0].date}T00:00:00Z`) === 86_400_000;
    const twoLowDays = twoConsecutiveCalendarDays && lastTwo.every((point) => point.vResting < threshold);
    const twoRecoveredDays = twoConsecutiveCalendarDays &&
      lastTwo.every((point) => point.vResting >= threshold + AUX_ALERT_RECOVERY_MARGIN_V);

    if (!episodeActive && twoLowDays) {
      episodeActive = true;
      sendAcute = true;
    } else if (episodeActive && twoRecoveredDays) {
      episodeActive = false;
    }
  } else {
    episodeActive = false;
  }

  const baselineResult = computeAuxVoltageBaseline(points);
  const recent = resting.slice(-AUX_DECLINE_LOOKBACK_DAYS);
  const latestVoltage = latest?.vResting ?? null;
  const aboveAcute = threshold == null || (latestVoltage != null && latestVoltage >= threshold);
  const declining = baselineResult.sufficient && recent.length >= 2 && latestVoltage != null &&
    baselineResult.baseline != null &&
    baselineResult.baseline - latestVoltage >= AUX_DECLINE_FROM_BASELINE_V &&
    recent[0].vResting - latestVoltage >= AUX_DECLINE_OVER_LOOKBACK_V;
  const digestAlreadySent = state.lastDigestAt != null && isSameUtcWeek(state.lastDigestAt, now);
  const sendDigest = !sendAcute && aboveAcute && declining && !digestAlreadySent;

  return {
    sendAcute,
    sendDigest,
    nextState: {
      acuteEpisodeActive: episodeActive,
      lastDigestAt: sendDigest ? now : state.lastDigestAt,
    },
    latestVoltage,
    baseline: baselineResult.baseline,
  };
}
