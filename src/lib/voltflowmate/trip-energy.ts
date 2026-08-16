export const MAX_TRIP_ENERGY_GAP_SECONDS = 180;

export type PowerEnergyPoint = {
  device_time: string;
  power_kw?: number | null;
  current_trip_distance_km?: number | null;
  odometer_km?: number | null;
};

export type RegenRecoverySegment = {
  time: number;
  distanceKm: number | null;
  regenKwh: number;
  powerKw: number | null;
};

export const MIN_REGEN_RECOVERY_KWH = 0.0001;
export const MAX_REGEN_RECOVERY_BARS = 72;

export type TripEnergySummary = {
  regen_energy_kwh: number | null;
  traction_energy_kwh: number | null;
  power_sample_count: number;
};

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function elapsedSeconds(from: string, to: string) {
  const seconds = (Date.parse(to) - Date.parse(from)) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function intervalEnergyKwh(fromPowerKw: number, toPowerKw: number, dtSeconds: number) {
  if (fromPowerKw >= 0 && toPowerKw >= 0) {
    return {
      traction: ((fromPowerKw + toPowerKw) / 2) * (dtSeconds / 3600),
      regen: 0,
    };
  }

  if (fromPowerKw <= 0 && toPowerKw <= 0) {
    return {
      traction: 0,
      regen: ((Math.abs(fromPowerKw) + Math.abs(toPowerKw)) / 2) * (dtSeconds / 3600),
    };
  }

  const zeroFraction = fromPowerKw / (fromPowerKw - toPowerKw);
  const clampedZeroFraction = Math.min(1, Math.max(0, zeroFraction));

  if (fromPowerKw > 0) {
    return {
      traction: (fromPowerKw * clampedZeroFraction * dtSeconds) / 2 / 3600,
      regen: (Math.abs(toPowerKw) * (1 - clampedZeroFraction) * dtSeconds) / 2 / 3600,
    };
  }

  return {
    traction: (toPowerKw * (1 - clampedZeroFraction) * dtSeconds) / 2 / 3600,
    regen: (Math.abs(fromPowerKw) * clampedZeroFraction * dtSeconds) / 2 / 3600,
  };
}

export function calculateTripEnergy(
  points: PowerEnergyPoint[],
  maxGapSeconds = MAX_TRIP_ENERGY_GAP_SECONDS,
): TripEnergySummary {
  let regenEnergyKwh = 0;
  let tractionEnergyKwh = 0;
  let powerSampleCount = 0;

  for (let index = 0; index < points.length; index += 1) {
    if (finiteNumber(points[index].power_kw) != null) {
      powerSampleCount += 1;
    }

    if (index === 0) continue;

    const previous = points[index - 1];
    const current = points[index];
    const dtSeconds = elapsedSeconds(previous.device_time, current.device_time);
    if (dtSeconds == null || dtSeconds > maxGapSeconds) continue;

    const previousPower = finiteNumber(previous.power_kw);
    const currentPower = finiteNumber(current.power_kw);
    if (previousPower == null || currentPower == null) continue;

    const energy = intervalEnergyKwh(previousPower, currentPower, dtSeconds);
    regenEnergyKwh += energy.regen;
    tractionEnergyKwh += energy.traction;
  }

  return {
    regen_energy_kwh: powerSampleCount > 1 ? regenEnergyKwh : null,
    traction_energy_kwh: powerSampleCount > 1 ? tractionEnergyKwh : null,
    power_sample_count: powerSampleCount,
  };
}

export function calculateCumulativeRegenPoints(
  points: PowerEnergyPoint[],
  maxGapSeconds = MAX_TRIP_ENERGY_GAP_SECONDS,
) {
  let recoveredKwh = 0;
  const cumulative: Array<{ time: number; value: number; power_kw: number | null }> = [];

  for (let index = 0; index < points.length; index += 1) {
    const currentTime = Date.parse(points[index].device_time);
    if (!Number.isFinite(currentTime)) continue;

    if (index > 0) {
      const previous = points[index - 1];
      const dtSeconds = elapsedSeconds(previous.device_time, points[index].device_time);
      const previousPower = finiteNumber(previous.power_kw);
      const currentPower = finiteNumber(points[index].power_kw);

      if (
        dtSeconds != null &&
        dtSeconds <= maxGapSeconds &&
        previousPower != null &&
        currentPower != null
      ) {
        recoveredKwh += intervalEnergyKwh(previousPower, currentPower, dtSeconds).regen;
      }
    }

    cumulative.push({
      time: currentTime,
      value: recoveredKwh,
      power_kw: finiteNumber(points[index].power_kw),
    });
  }

  return cumulative;
}

function segmentDistanceKm(
  point: PowerEnergyPoint,
  startOdometerKm: number | null,
) {
  const tripDistance = finiteNumber(point.current_trip_distance_km);
  if (tripDistance != null) return tripDistance;

  const odometerKm = finiteNumber(point.odometer_km);
  if (odometerKm != null && startOdometerKm != null) {
    return Math.max(0, odometerKm - startOdometerKm);
  }

  return null;
}

export function calculateRegenRecoverySegments(
  points: PowerEnergyPoint[],
  maxGapSeconds = MAX_TRIP_ENERGY_GAP_SECONDS,
) {
  const segments: RegenRecoverySegment[] = [];
  const startOdometerKm = finiteNumber(points[0]?.odometer_km);

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const currentTime = Date.parse(current.device_time);
    if (!Number.isFinite(currentTime)) continue;

    const dtSeconds = elapsedSeconds(previous.device_time, current.device_time);
    const previousPower = finiteNumber(previous.power_kw);
    const currentPower = finiteNumber(current.power_kw);
    if (
      dtSeconds == null ||
      dtSeconds > maxGapSeconds ||
      previousPower == null ||
      currentPower == null
    ) {
      continue;
    }

    const regenKwh = intervalEnergyKwh(previousPower, currentPower, dtSeconds).regen;
    if (regenKwh <= MIN_REGEN_RECOVERY_KWH) continue;

    segments.push({
      time: currentTime,
      distanceKm: segmentDistanceKm(current, startOdometerKm),
      regenKwh,
      powerKw: currentPower,
    });
  }

  return segments;
}

export function prepareRegenRecoveryBars(
  segments: RegenRecoverySegment[],
  maxBars = MAX_REGEN_RECOVERY_BARS,
): {
  xAxis: "distance" | "time";
  segments: Array<{ x: number; regenKwh: number }>;
  hasData: boolean;
} {
  if (segments.length === 0) {
    return {
      xAxis: "time" as const,
      segments: [] as Array<{ x: number; regenKwh: number }>,
      hasData: false,
    };
  }

  const distanceCoverage = segments.filter((segment) => segment.distanceKm != null).length / segments.length;
  const useDistance = distanceCoverage >= 0.5;
  const xAxis = useDistance ? "distance" : "time";
  const rawBars = segments.map((segment) => ({
    x: useDistance ? segment.distanceKm! : segment.time,
    regenKwh: segment.regenKwh,
  }));

  if (rawBars.length <= maxBars) {
    return { xAxis, segments: rawBars, hasData: true };
  }

  const xs = rawBars.map((bar) => bar.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const span = Math.max(maxX - minX, useDistance ? 0.1 : 60_000);
  const bins = Array.from({ length: maxBars }, () => 0);

  for (const bar of rawBars) {
    const ratio = (bar.x - minX) / span;
    const binIndex = Math.min(maxBars - 1, Math.max(0, Math.floor(ratio * maxBars)));
    bins[binIndex] += bar.regenKwh;
  }

  const binnedBars = bins
    .map((regenKwh, index) => ({
      x: minX + ((index + 0.5) * span) / maxBars,
      regenKwh,
    }))
    .filter((bar) => bar.regenKwh > MIN_REGEN_RECOVERY_KWH);

  return {
    xAxis,
    segments: binnedBars,
    hasData: binnedBars.length > 0,
  };
}
