/** The subset of a closed session needed to decide whether recovery may repair it. */
export type RecoveryRepairableSession = {
  id: string;
  status: string;
  started_at: string | null;
  stopped_at: string | null;
  manual_entry: boolean;
  energy_overridden: boolean;
  tariff_manual: boolean;
  session_origin: string;
};

export type RecoverySessionWindow = {
  startedAt: string;
  stoppedAt: string;
};

/**
 * Recovery closes at the first explicit non-charging sample, while a live auto-session
 * deliberately waits for a second confirmation. Keep this bounded to the recovery
 * detector's three-minute inter-sample limit: anything longer is not an unambiguous tail.
 */
export const RECOVERY_TAIL_STOP_GRACE_MS = 3 * 60_000;

/**
 * A delayed batch may start a short, normal auto session from its newly-fresh tail before
 * recovery sees the full closed charge. Repair only that unambiguous tail. A receipt,
 * corrected amount, manually selected tariff, another recovered row, any open row, or a
 * partial/multiple overlap remains an overlap and must not be changed automatically.
 */
export function recoveryTailSessionToRepair(
  sessions: readonly RecoveryRepairableSession[],
  candidate: RecoverySessionWindow,
): RecoveryRepairableSession | null {
  if (sessions.length !== 1) return null;

  const session = sessions[0]!;
  if (
    (session.status !== "completed" && session.status !== "stopped") ||
    session.manual_entry ||
    session.energy_overridden ||
    session.tariff_manual ||
    session.session_origin !== "legacy" ||
    session.started_at == null ||
    session.stopped_at == null
  ) {
    return null;
  }

  const candidateStart = Date.parse(candidate.startedAt);
  const candidateStop = Date.parse(candidate.stoppedAt);
  const sessionStart = Date.parse(session.started_at);
  const sessionStop = Date.parse(session.stopped_at);
  if (
    !Number.isFinite(candidateStart) ||
    !Number.isFinite(candidateStop) ||
    !Number.isFinite(sessionStart) ||
    !Number.isFinite(sessionStop) ||
    candidateStart > sessionStart ||
    sessionStop > candidateStop + RECOVERY_TAIL_STOP_GRACE_MS
  ) {
    return null;
  }

  // An exact window is a duplicate, not a tail that needs repair. The small trailing
  // allowance above is specifically for the live reducer's second stop confirmation.
  return candidateStart < sessionStart || candidateStop !== sessionStop ? session : null;
}
