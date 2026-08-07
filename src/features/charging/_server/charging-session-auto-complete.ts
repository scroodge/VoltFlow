import type { StopSessionProgress } from "./charging-session-finalize.ts";

type AutoCompletionSession = Pick<
  { target_percent: number },
  "target_percent"
>;

/**
 * Completion is a server decision: measured server progress wins over a client-side
 * wall-clock estimate, and a measured value below target blocks the estimate.
 */
export function resolveAutoCompletionProgress({
  session,
  measuredProgress,
  mathProgress,
}: {
  session: AutoCompletionSession;
  measuredProgress: StopSessionProgress | null;
  mathProgress: StopSessionProgress | null;
}): StopSessionProgress | null {
  const progress = measuredProgress ?? mathProgress;
  if (!progress || progress.currentPercent < session.target_percent) return null;
  return progress;
}
