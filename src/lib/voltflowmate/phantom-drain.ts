const MIN_PARKED_INTERVAL_MS = 4 * 60 * 60 * 1000;
const MAX_SAMPLE_GAP_MS = 6 * 60 * 60 * 1000;

export type PhantomDrainSample = {
  deviceTime: string;
  soc: unknown;
  speedKmh?: unknown;
  powerKw?: unknown;
  chargePowerKw?: unknown;
  isCharging?: unknown;
  chargeGunState?: string | null;
};

export type PhantomDrainDay = {
  date: string;
  socStart: number;
  socEnd: number;
  drainPercent: number;
  idleHours: number;
};

export type PhantomDrainNight = {
  startedAt: string;
  endedAt: string;
  socStart: number;
  socEnd: number;
  drainPercent: number;
  idleHours: number;
};

type ParkedInterval = {
  date: string;
  startedAtMs: number;
  endedAtMs: number;
  firstSoc: number | null;
  lastSoc: number | null;
};

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function booleanFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
}

function isParkedUnplugged(sample: PhantomDrainSample): boolean {
  const speedKmh = finiteNumber(sample.speedKmh) ?? 0;
  const powerKw = finiteNumber(sample.powerKw) ?? 0;
  const chargePowerKw = finiteNumber(sample.chargePowerKw) ?? 0;
  const charging =
    chargePowerKw > 0 ||
    (sample.chargeGunState !== "1" && booleanFlag(sample.isCharging));

  return speedKmh <= 0.5 && Math.abs(powerKw) <= 0.1 && !charging;
}

/**
 * Walks samples in time order and returns continuous parked intervals. Movement,
 * charging, and telemetry gaps always split an interval. When `splitByDay` is set,
 * a UTC midnight also splits it (the daily view); the night view keeps it whole.
 */
function collectParkedIntervals(
  input: readonly PhantomDrainSample[],
  { splitByDay }: { splitByDay: boolean },
): ParkedInterval[] {
  const samples = [...input].sort(
    (left, right) => Date.parse(left.deviceTime) - Date.parse(right.deviceTime),
  );
  const intervals: ParkedInterval[] = [];
  let interval: ParkedInterval | null = null;

  function finishInterval() {
    if (interval == null) return;
    intervals.push(interval);
    interval = null;
  }

  for (const sample of samples) {
    const timestampMs = Date.parse(sample.deviceTime);
    if (!Number.isFinite(timestampMs) || !isParkedUnplugged(sample)) {
      finishInterval();
      continue;
    }

    const date = new Date(timestampMs).toISOString().slice(0, 10);
    const soc = finiteNumber(sample.soc);
    const gapMs = interval == null ? null : timestampMs - interval.endedAtMs;
    const continuesInterval =
      interval != null &&
      (!splitByDay || interval.date === date) &&
      gapMs != null &&
      gapMs > 0 &&
      gapMs < MAX_SAMPLE_GAP_MS;

    if (!continuesInterval) {
      finishInterval();
      interval = {
        date,
        startedAtMs: timestampMs,
        endedAtMs: timestampMs,
        firstSoc: soc,
        lastSoc: soc,
      };
      continue;
    }

    if (interval == null) continue;
    interval.endedAtMs = timestampMs;
    if (soc != null) {
      interval.firstSoc ??= soc;
      interval.lastSoc = soc;
    }
  }

  finishInterval();
  return intervals;
}

/** Only a positive net SOC loss over at least four continuous parked hours counts. */
function isPhantomDrainInterval(interval: ParkedInterval): boolean {
  return (
    interval.endedAtMs - interval.startedAtMs >= MIN_PARKED_INTERVAL_MS &&
    interval.firstSoc != null &&
    interval.lastSoc != null &&
    interval.firstSoc > interval.lastSoc
  );
}

/**
 * Calculates daily phantom drain from continuous parked intervals. UTC midnight,
 * movement, charging, and telemetry gaps split an interval. Only a positive net SOC
 * loss over at least four continuous parked hours contributes to the daily result.
 */
export function calculatePhantomDrainDays(
  input: readonly PhantomDrainSample[],
): PhantomDrainDay[] {
  const byDay = new Map<string, PhantomDrainDay>();

  for (const interval of collectParkedIntervals(input, { splitByDay: true })) {
    if (!isPhantomDrainInterval(interval)) continue;

    const idleHours = (interval.endedAtMs - interval.startedAtMs) / (60 * 60 * 1000);
    const drainPercent = interval.firstSoc! - interval.lastSoc!;
    const existing = byDay.get(interval.date);
    if (existing == null) {
      byDay.set(interval.date, {
        date: interval.date,
        socStart: interval.firstSoc!,
        socEnd: interval.lastSoc!,
        drainPercent,
        idleHours,
      });
    } else {
      existing.socEnd = interval.lastSoc!;
      existing.drainPercent += drainPercent;
      existing.idleHours += idleHours;
    }
  }

  return [...byDay.values()].sort((left, right) => right.date.localeCompare(left.date));
}

/**
 * Returns the most recent single parked night that qualifies as phantom drain, or
 * null. Unlike the daily view, an interval crossing UTC midnight stays one night.
 */
export function findLastPhantomDrainNight(
  input: readonly PhantomDrainSample[],
): PhantomDrainNight | null {
  const qualifying = collectParkedIntervals(input, { splitByDay: false }).filter(
    isPhantomDrainInterval,
  );
  const last = qualifying.at(-1);
  if (last == null) return null;

  return {
    startedAt: new Date(last.startedAtMs).toISOString(),
    endedAt: new Date(last.endedAtMs).toISOString(),
    socStart: last.firstSoc!,
    socEnd: last.lastSoc!,
    drainPercent: last.firstSoc! - last.lastSoc!,
    idleHours: (last.endedAtMs - last.startedAtMs) / (60 * 60 * 1000),
  };
}
