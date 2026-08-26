/** Consecutive parked charging samples before auto-start (≈4s at 1 Hz ingest). */
export const AUTO_CHARGING_MIN_CONSECUTIVE_START_SAMPLES = 4;
/** Consecutive unplug samples before auto-stop while parked. */
export const AUTO_CHARGING_MIN_CONSECUTIVE_UNPLUG_SAMPLES = 2;
/** @deprecated Use START/UNPLUG-specific constants. */
export const AUTO_CHARGING_MIN_CONSECUTIVE_SAMPLES = AUTO_CHARGING_MIN_CONSECUTIVE_START_SAMPLES;
export const AUTO_CHARGING_DRIVE_STOP_SPEED_KMH = 5;
export const AUTO_CHARGING_DEFAULT_TARGET_PERCENT = 100;
/**
 * Parked+charging telemetry arrives at ~1 sample/min, not the ~1 Hz of driving, so the
 * confirmation streak above spans minutes of real charging. The session is therefore
 * backdated to the streak's first charging sample, and further to the last pre-charge
 * (idle) SOC when that reading is no older than this — it covers the telemetry gap while
 * parking and plugging in. Beyond this window the idle reading is ignored: the car may
 * have driven since, and a stale high SOC would under-count the session's energy.
 */
export const AUTO_CHARGING_BACKDATE_MAX_IDLE_GAP_MS = 30 * 60_000;
/**
 * Di+ can keep echoing the last real `charge_power_kw`/SOC reading after a charge has
 * genuinely ended while the gun stays plugged in (car `way`; see BACKLOG.md "Live charge
 * power can get stuck on a stale nonzero charge_power_kw..."). If a charging sample's SOC
 * and charge power are bit-identical to the last charging sample's for at least this long,
 * treat it as a stale cached value rather than live measurement and let it drive auto-stop
 * the same way an explicit unplug would.
 */
export const AUTO_CHARGING_FROZEN_READING_STALE_MS = 10 * 60_000;
/**
 * How long an open session may keep reporting an explicit ~0 kW `charge_power_kw` before
 * it is closed, regardless of SOC.
 *
 * This is the "charger stopped but the gun is still in" case. Di+ keeps `is_charging`
 * true for as long as the gun is connected, so the session's keep-alive predicate
 * (`isMateAutoSessionChargingSustained`) correctly holds it open — something has to end
 * it. The frozen-reading check above cannot: it needs SOC *and* power bit-identical, and
 * a parked car's SOC drifts *down* (100 → 99.9 → 99.8) from standby draw, resetting that
 * timer at every step. This check watches power only, so drift cannot defeat it.
 *
 * Must stay comfortably longer than a genuine mid-charge zero blip. Charging telemetry
 * queues at 10 s and is delivered in 60 s bulk batches, so this spans several batches.
 */
export const AUTO_CHARGING_ZERO_POWER_STALL_MS = 5 * 60_000;
/** `charge_power_kw` at or below this is "no energy flowing" (mirrors the domain threshold). */
export const AUTO_CHARGING_ZERO_POWER_THRESHOLD_KW = 0.1;

export type AutoChargingSessionState = {
  consecutiveChargingSamples: number;
  consecutiveUnplugSamples: number;
  lastIsCharging: boolean;
  /** SOC and time of the first charging sample of the current streak. */
  streakStartPercent: number | null;
  streakStartDeviceTime: string | null;
  /** SOC and time of the most recent non-charging sample — the pre-plug-in reading. */
  lastIdlePercent: number | null;
  lastIdleDeviceTime: string | null;
  /**
   * SOC/charge_power_kw of the most recent charging sample and the device time since both
   * last changed — detects a Di+ reading stuck on a cached value (see
   * AUTO_CHARGING_FROZEN_READING_STALE_MS). Only tracked while a session is open; null
   * otherwise.
   */
  frozenSoc: number | null;
  frozenChargePowerKw: number | null;
  frozenSinceDeviceTime: string | null;
  /**
   * Device time since `charge_power_kw` was first seen at an explicit ~0 while a session
   * was open — see AUTO_CHARGING_ZERO_POWER_STALL_MS. Null whenever real power is flowing
   * (or none is reported at all, which is a different case: no measurement, not zero).
   */
  zeroPowerSinceDeviceTime: string | null;
};

const NOT_FROZEN = {
  frozenSoc: null,
  frozenChargePowerKw: null,
  frozenSinceDeviceTime: null,
} as const;

const NO_ZERO_POWER = { zeroPowerSinceDeviceTime: null } as const;

export type AutoChargingSessionAction =
  | { type: "none" }
  | { type: "start"; startPercent: number; startedAt: string; chargerPowerKw: number }
  | { type: "stop"; currentPercent: number };

function clampStartPercent(soc: number) {
  return Math.min(99.9, Math.max(0, soc));
}

/**
 * The SOC and time charging actually began, as opposed to the sample that confirmed it.
 * Prefers the last idle reading (the true pre-charge SOC), falling back to the streak's
 * first charging sample, and finally to the confirming sample itself.
 */
function resolveBackdatedStart({
  state,
  soc,
  deviceTime,
}: {
  state: AutoChargingSessionState;
  soc: number;
  deviceTime: string;
}): { startPercent: number; startedAt: string } {
  const basePercent = state.streakStartPercent ?? soc;
  const startedAt = state.streakStartDeviceTime ?? deviceTime;

  const { lastIdlePercent, lastIdleDeviceTime } = state;
  if (lastIdlePercent == null || lastIdleDeviceTime == null) {
    return { startPercent: clampStartPercent(basePercent), startedAt };
  }

  // An idle SOC above the first charging sample means the car discharged in between;
  // trusting it would inflate the session. Only ever back off to a lower SOC.
  if (lastIdlePercent > basePercent) {
    return { startPercent: clampStartPercent(basePercent), startedAt };
  }

  const gapMs = Date.parse(startedAt) - Date.parse(lastIdleDeviceTime);
  if (!Number.isFinite(gapMs) || gapMs < 0 || gapMs > AUTO_CHARGING_BACKDATE_MAX_IDLE_GAP_MS) {
    return { startPercent: clampStartPercent(basePercent), startedAt };
  }

  return { startPercent: clampStartPercent(lastIdlePercent), startedAt };
}

export function nextAutoChargingSessionStep({
  state,
  isCharging,
  canStartSession,
  soc,
  speedKmh,
  hasActiveSession,
  chargerPowerKw,
  rawChargePowerKw = null,
  deviceTime,
}: {
  state: AutoChargingSessionState | null;
  /**
   * Keep-alive signal — whether an *already-open* session is still charging
   * (`isMateAutoSessionChargingSustained`). Deliberately tolerant: true while the gun is
   * connected, so a momentary zero-kW reading mid-charge does not end a real session.
   */
  isCharging: boolean;
  /**
   * Start gate — whether this sample is real, measured charging
   * (`isMateAutoSessionCharging`). Strict: requires actual charge power, because Di+
   * reports `is_charging` for as long as the gun is plugged in, long after a charger has
   * stopped. Defaults to `isCharging` when omitted, which is the pre-split behavior.
   */
  canStartSession?: boolean;
  soc: number | null;
  speedKmh: number | null;
  hasActiveSession: boolean;
  chargerPowerKw: number | null;
  /**
   * The sample's own `charge_power_kw`, undefaulted (unlike `chargerPowerKw`, which the
   * caller may have substituted with the car's default power). Used only to detect a
   * frozen/stale or stalled-at-zero reading — a defaulted value would look "unchanged" on
   * every sample that has no real power telemetry at all, which is a different and far
   * more common case.
   */
  rawChargePowerKw?: number | null;
  deviceTime: string;
}): { state: AutoChargingSessionState; action: AutoChargingSessionAction } {
  const canStart = canStartSession ?? isCharging;
  const prev: AutoChargingSessionState = state ?? {
    consecutiveChargingSamples: 0,
    consecutiveUnplugSamples: 0,
    lastIsCharging: false,
    streakStartPercent: null,
    streakStartDeviceTime: null,
    lastIdlePercent: null,
    lastIdleDeviceTime: null,
    ...NOT_FROZEN,
    ...NO_ZERO_POWER,
  };

  // Explicitly measured "no energy flowing", as opposed to no power reading at all
  // (null) — only the former can end a session via the zero-power stall.
  const isExplicitZeroPower =
    rawChargePowerKw != null && rawChargePowerKw <= AUTO_CHARGING_ZERO_POWER_THRESHOLD_KW;

  const idle =
    soc != null
      ? { lastIdlePercent: soc, lastIdleDeviceTime: deviceTime }
      : { lastIdlePercent: prev.lastIdlePercent, lastIdleDeviceTime: prev.lastIdleDeviceTime };
  // Charging samples carry the idle reading unchanged: the pre-charge SOC must never be
  // overwritten with one taken while the battery is already filling.
  const carriedIdle = {
    lastIdlePercent: prev.lastIdlePercent,
    lastIdleDeviceTime: prev.lastIdleDeviceTime,
  };
  const noStreak = { streakStartPercent: null, streakStartDeviceTime: null };

  if (hasActiveSession) {
    const drivingAway = speedKmh != null && speedKmh > AUTO_CHARGING_DRIVE_STOP_SPEED_KMH;
    if (!isCharging) {
      const consecutiveUnplugSamples = prev.consecutiveUnplugSamples + 1;
      const shouldStop =
        drivingAway ||
        consecutiveUnplugSamples >= AUTO_CHARGING_MIN_CONSECUTIVE_UNPLUG_SAMPLES;
      if (shouldStop && soc != null) {
        return {
          state: {
            consecutiveChargingSamples: 0,
            consecutiveUnplugSamples: 0,
            lastIsCharging: false,
            ...noStreak,
            ...idle,
            ...NOT_FROZEN,
            ...NO_ZERO_POWER,
          },
          action: { type: "stop", currentPercent: soc },
        };
      }
      return {
        state: {
          consecutiveChargingSamples: 0,
          consecutiveUnplugSamples: consecutiveUnplugSamples,
          lastIsCharging: false,
          ...noStreak,
          ...idle,
          ...NOT_FROZEN,
          ...NO_ZERO_POWER,
        },
        action: { type: "none" },
      };
    }

    // Reported charging, but the charger may simply have stopped with the gun left in —
    // Di+ keeps `is_charging` true indefinitely in that state. A *sustained* run of
    // explicitly-zero charge power ends the session at any SOC, where the frozen-reading
    // check below cannot (parked SOC drift resets it). See
    // AUTO_CHARGING_ZERO_POWER_STALL_MS.
    const zeroPowerSinceDeviceTime = isExplicitZeroPower
      ? (prev.zeroPowerSinceDeviceTime ?? deviceTime)
      : null;
    if (zeroPowerSinceDeviceTime != null && soc != null) {
      const zeroPowerMs = Date.parse(deviceTime) - Date.parse(zeroPowerSinceDeviceTime);
      if (Number.isFinite(zeroPowerMs) && zeroPowerMs >= AUTO_CHARGING_ZERO_POWER_STALL_MS) {
        return {
          state: {
            consecutiveChargingSamples: 0,
            consecutiveUnplugSamples: 0,
            lastIsCharging: false,
            ...noStreak,
            ...idle,
            ...NOT_FROZEN,
            ...NO_ZERO_POWER,
          },
          action: { type: "stop", currentPercent: soc },
        };
      }
    }

    // Reported charging — but Di+ can keep echoing the last real charge_power_kw/SOC
    // reading after a charge has genuinely ended while the gun stays plugged in. If both
    // are bit-identical to the last charging sample's for AUTO_CHARGING_FROZEN_READING_STALE_MS,
    // treat it as a stale cached value and route it through the same consecutive-unplug
    // confirmation as an explicit unplug, rather than holding the session open forever.
    const readingUnchanged =
      soc != null &&
      rawChargePowerKw != null &&
      prev.frozenSoc === soc &&
      prev.frozenChargePowerKw === rawChargePowerKw &&
      prev.frozenSinceDeviceTime != null;

    const frozenSinceDeviceTime = readingUnchanged
      ? (prev.frozenSinceDeviceTime as string)
      : deviceTime;
    const frozenDurationMs = Date.parse(deviceTime) - Date.parse(frozenSinceDeviceTime);
    const isStaleFrozenReading =
      readingUnchanged &&
      Number.isFinite(frozenDurationMs) &&
      frozenDurationMs >= AUTO_CHARGING_FROZEN_READING_STALE_MS;

    const frozenTracking = {
      frozenSoc: soc,
      frozenChargePowerKw: rawChargePowerKw,
      frozenSinceDeviceTime,
    };

    if (isStaleFrozenReading) {
      const consecutiveUnplugSamples = prev.consecutiveUnplugSamples + 1;
      if (
        consecutiveUnplugSamples >= AUTO_CHARGING_MIN_CONSECUTIVE_UNPLUG_SAMPLES &&
        soc != null
      ) {
        return {
          state: {
            consecutiveChargingSamples: 0,
            consecutiveUnplugSamples: 0,
            lastIsCharging: false,
            ...noStreak,
            ...idle,
            ...NOT_FROZEN,
            ...NO_ZERO_POWER,
          },
          action: { type: "stop", currentPercent: soc },
        };
      }
      return {
        state: {
          consecutiveChargingSamples: 0,
          consecutiveUnplugSamples,
          lastIsCharging: true,
          ...noStreak,
          ...carriedIdle,
          ...frozenTracking,
          zeroPowerSinceDeviceTime,
        },
        action: { type: "none" },
      };
    }

    return {
      state: {
        consecutiveChargingSamples: 0,
        consecutiveUnplugSamples: 0,
        lastIsCharging: true,
        ...noStreak,
        ...carriedIdle,
        ...frozenTracking,
        zeroPowerSinceDeviceTime,
      },
      action: { type: "none" },
    };
  }

  // No active session. A sample that is plugged-in-but-not-actually-charging (tolerant
  // `isCharging` true, strict `canStart` false) deliberately falls into the idle branch:
  // its SOC is exactly the pre-charge baseline that backdating wants, so the car can sit
  // plugged in for hours on a delayed-start charger and still open a session with the
  // right start percent the moment real power appears.
  const drivingAway = speedKmh != null && speedKmh > AUTO_CHARGING_DRIVE_STOP_SPEED_KMH;
  if (!canStart || drivingAway) {
    return {
      state: {
        consecutiveChargingSamples: 0,
        consecutiveUnplugSamples: 0,
        lastIsCharging: false,
        ...noStreak,
        ...idle,
        ...NOT_FROZEN,
        ...NO_ZERO_POWER,
      },
      action: { type: "none" },
    };
  }

  const consecutiveChargingSamples = prev.consecutiveChargingSamples + 1;
  const streakStart =
    prev.consecutiveChargingSamples === 0
      ? { streakStartPercent: soc, streakStartDeviceTime: deviceTime }
      : {
          streakStartPercent: prev.streakStartPercent,
          streakStartDeviceTime: prev.streakStartDeviceTime,
        };

  if (
    consecutiveChargingSamples >= AUTO_CHARGING_MIN_CONSECUTIVE_START_SAMPLES &&
    soc != null &&
    soc < AUTO_CHARGING_DEFAULT_TARGET_PERCENT
  ) {
    const { startPercent, startedAt } = resolveBackdatedStart({
      state: { ...prev, ...streakStart },
      soc,
      deviceTime,
    });
    return {
      state: {
        consecutiveChargingSamples,
        consecutiveUnplugSamples: 0,
        lastIsCharging: true,
        ...noStreak,
        lastIdlePercent: null,
        lastIdleDeviceTime: null,
        ...NOT_FROZEN,
        ...NO_ZERO_POWER,
      },
      action: {
        type: "start",
        startPercent,
        startedAt,
        chargerPowerKw: chargerPowerKw ?? 7.2,
      },
    };
  }

  return {
    state: {
      consecutiveChargingSamples,
      consecutiveUnplugSamples: 0,
      lastIsCharging: true,
      ...streakStart,
      ...carriedIdle,
      ...NOT_FROZEN,
      ...NO_ZERO_POWER,
    },
    action: { type: "none" },
  };
}
