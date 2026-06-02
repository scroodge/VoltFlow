/**
 * Deterministic charging math from session parameters + wall clock.
 * Rates use charger AC power; battery fill rate follows (P / E_batt) * 100 %/h.
 */

export type ChargingParams = {
  startPercent: number;
  targetPercent: number;
  batteryCapacityKwh: number;
  chargerPowerKw: number;
  efficiencyPercent: number;
  pricePerKwh: number;
};

export function percentPerHour(params: ChargingParams): number {
  return (params.chargerPowerKw / params.batteryCapacityKwh) * 100;
}

export function percentPerSecond(params: ChargingParams): number {
  return percentPerHour(params) / 3600;
}

export function energyNeededKwh(
  batteryCapacityKwh: number,
  fromPercent: number,
  toPercent: number,
): number {
  return (batteryCapacityKwh * (toPercent - fromPercent)) / 100;
}

export function energyFromGridKwh(
  energyNeededKwh: number,
  efficiencyPercent: number,
): number {
  return energyNeededKwh / (efficiencyPercent / 100);
}

export function chargingHoursFromEnergy(
  energyFromGridKwh: number,
  chargerPowerKw: number,
): number {
  return energyFromGridKwh / chargerPowerKw;
}

export function costFromGridEnergy(
  energyFromGridKwh: number,
  pricePerKwh: number,
): number {
  return energyFromGridKwh * pricePerKwh;
}

export function chargedEnergyPerSecond(chargerPowerKw: number): number {
  return chargerPowerKw / 3600;
}

export function costPerSecond(
  pricePerKwh: number,
  chargerPowerKw: number,
): number {
  return (pricePerKwh * chargerPowerKw) / 3600;
}

export type DerivedChargingState = {
  currentPercent: number;
  chargedEnergyKwh: number;
  estimatedCost: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  isComplete: boolean;
};

/** Final session progress from a measured SOC (live/telemetry), not wall-clock math. */
export function deriveSessionProgressFromSoc(
  params: ChargingParams,
  soc: number,
): Pick<DerivedChargingState, "currentPercent" | "chargedEnergyKwh" | "estimatedCost"> {
  const currentPercent = Math.min(
    params.targetPercent,
    Math.max(params.startPercent, soc),
  );
  const batteryEnergyKwh = energyNeededKwh(
    params.batteryCapacityKwh,
    params.startPercent,
    currentPercent,
  );
  const chargedEnergyKwh = energyFromGridKwh(batteryEnergyKwh, params.efficiencyPercent);
  const estimatedCost = costFromGridEnergy(chargedEnergyKwh, params.pricePerKwh);
  return { currentPercent, chargedEnergyKwh, estimatedCost };
}

export function deriveChargingState(
  params: ChargingParams,
  startedAtMs: number,
  nowMs: number,
): DerivedChargingState {
  const rate = percentPerSecond(params);
  const elapsedSeconds = Math.max(0, (nowMs - startedAtMs) / 1000);
  const rawPercent = params.startPercent + rate * elapsedSeconds;
  const isComplete = rawPercent >= params.targetPercent;
  const currentPercent = isComplete
    ? params.targetPercent
    : Math.min(params.targetPercent, rawPercent);

  const activeSeconds = isComplete
    ? (params.targetPercent - params.startPercent) / rate
    : elapsedSeconds;

  const chargedEnergyKwh = (params.chargerPowerKw * activeSeconds) / 3600;
  const estimatedCost = costPerSecond(
    params.pricePerKwh,
    params.chargerPowerKw,
  ) * activeSeconds;

  const remainingPercent = Math.max(0, params.targetPercent - currentPercent);
  const remainingSeconds =
    rate > 0 ? remainingPercent / rate : Number.POSITIVE_INFINITY;

  return {
    currentPercent,
    chargedEnergyKwh,
    estimatedCost,
    elapsedSeconds: activeSeconds,
    remainingSeconds: Number.isFinite(remainingSeconds)
      ? remainingSeconds
      : 0,
    isComplete,
  };
}

export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** Project SOC at a future wall-clock time from charging params. */
export function projectSocAtTime(
  params: ChargingParams,
  startedAtMs: number,
  targetMs: number,
): number | null {
  const rate = percentPerSecond(params);
  if (rate <= 0) return null;
  const elapsedSeconds = Math.max(0, (targetMs - startedAtMs) / 1000);
  const projected = params.startPercent + rate * elapsedSeconds;
  return Math.min(params.targetPercent, projected);
}

/** Seconds until target SOC from current percent (or session start if lower). */
export function secondsUntilTargetSoc(
  params: ChargingParams,
  currentPercent: number,
): number | null {
  const rate = percentPerSecond(params);
  if (rate <= 0) return null;
  const remaining = params.targetPercent - currentPercent;
  if (remaining <= 0) return 0;
  return remaining / rate;
}
