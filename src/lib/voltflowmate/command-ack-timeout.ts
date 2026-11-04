/**
 * A command the car claimed (pending → sent) but never acked. The car normally acks within a
 * second; a lost ack (link flapping right after power-on) left the row `sent` forever and the
 * web spinning. Mate 0.6.4+ re-sends lost acks, and a late ack still overwrites the row (the
 * ack route updates by id), so expiring here only stops the web from waiting forever.
 */
export const SENT_ACK_TIMEOUT_MS = 2 * 60 * 1000;

export const SENT_ACK_TIMEOUT_RESULT = {
  error: "ack_timeout",
  timed_out: true,
} as const;

type CommandStatusRow = { id: string; status: string; created_at: string };

export function staleSentCommandIds(
  rows: readonly CommandStatusRow[],
  nowMs: number,
): string[] {
  return rows
    .filter(
      (row) =>
        row.status === "sent" &&
        nowMs - new Date(row.created_at).getTime() > SENT_ACK_TIMEOUT_MS,
    )
    .map((row) => row.id);
}
