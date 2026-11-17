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
    candidateStop < sessionStop
  ) {
    return null;
  }

  // A matching window is a duplicate, not a tail that needs repair.
  return candidateStart < sessionStart || candidateStop > sessionStop ? session : null;
}
