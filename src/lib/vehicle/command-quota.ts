/**
 * Remote-command quota by plan. Free users get one command per 5 minutes and one camera
 * snapshot per 8 hours; Premium and admins are not limited. The two buckets are separate, so
 * a snapshot does not use up the next climate command and vice versa.
 *
 * Only commands that did something count: done ones, plus pending / sent ones still on their
 * way (otherwise a free user could queue several before the first lands). A command the car
 * rejected, that failed or timed out, or that di+ accepted but the car did not react to
 * (`verified: false` with a before/after `state`) is free.
 */
export type CommandTier = "free" | "premium" | "admin";

export const FREE_COMMAND_WINDOW_MS = 5 * 60 * 1000;
export const FREE_SNAPSHOT_WINDOW_MS = 8 * 60 * 60 * 1000;
export const CAMERA_SNAPSHOT_TYPE = "camera_snapshot";
export const COUNTED_STATUSES = ["pending", "sent", "done"] as const;

export type QuotaRow = {
  created_at: string;
  status: string;
  result?: Record<string, unknown> | null;
};

export function countsTowardQuota(row: QuotaRow): boolean {
  if (row.status === "pending" || row.status === "sent") return true;
  if (row.status !== "done") return false;
  const notConfirmed =
    row.result?.verified === false && row.result?.state != null;
  return !notConfirmed;
}

export type QuotaBucket = "command" | "snapshot";

export function quotaBucket(type: string): QuotaBucket {
  return type === CAMERA_SNAPSHOT_TYPE ? "snapshot" : "command";
}

export function quotaWindowMs(bucket: QuotaBucket): number {
  return bucket === "snapshot"
    ? FREE_SNAPSHOT_WINDOW_MS
    : FREE_COMMAND_WINDOW_MS;
}

export type QuotaBlock = { bucket: QuotaBucket; retryAfterSeconds: number };

/**
 * @param recent this user's commands in the same bucket, any order; uncounted ones are skipped.
 * @return null when the command may be sent.
 */
export function quotaBlock(
  tier: CommandTier,
  type: string,
  recent: readonly QuotaRow[],
  nowMs: number,
): QuotaBlock | null {
  if (tier !== "free") return null;
  const bucket = quotaBucket(type);
  const windowMs = quotaWindowMs(bucket);
  const inWindow = recent
    .filter(countsTowardQuota)
    .map((row) => new Date(row.created_at).getTime())
    .filter((at) => Number.isFinite(at) && nowMs - at < windowMs);
  if (inWindow.length === 0) return null;
  const oldest = Math.min(...inWindow);
  return {
    bucket,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((oldest + windowMs - nowMs) / 1000),
    ),
  };
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

export function quotaMessage(block: QuotaBlock): string {
  const next =
    block.bucket === "snapshot" ? "Следующий снимок" : "Следующая команда";
  return `Лимит бесплатного тарифа исчерпан. ${next} — через ${formatWait(block.retryAfterSeconds)}.`;
}

/** Shown with the quota message, so the limit reads as a rule, not an error. */
export const QUOTA_RULES =
  "Бесплатно: 1 команда в 5 минут и 1 снимок с камер в 8 часов. Невыполненные команды в лимит не входят. С Premium — без ограничений.";

export const QUOTA_SUPPORT_PITCH =
  "Команды идут через серверы VoltFlow: облако, базу данных и канал связи с машиной. Поддержка проекта оплачивает эту инфраструктуру и снимает ограничения.";
