/**
 * Mate «Отправить диагностику» bundles, relayed by `POST /api/bydmate/diagnostics` to the
 * developer's Telegram chat. The bot token stays on the server: a token baked into the APK
 * could be extracted and used to re-point the production webhook. VoltFlow stores only an
 * audit row per upload (`bydmate_diagnostic_uploads`), never the bundle. See BACKLOG
 * "Diagnostics".
 */

/** Gzip body cap: Vercel rejects request bodies over 4.5 MB. */
export const DIAGNOSTICS_MAX_GZIP_BYTES = 4 * 1024 * 1024;
/** Decompressed cap, so a gzip bomb cannot exhaust the function's memory. */
export const DIAGNOSTICS_MAX_TEXT_BYTES = 40 * 1024 * 1024;
export const DIAGNOSTICS_MAX_COMMENT_CHARS = 500;
export const DIAGNOSTICS_MAX_PER_VEHICLE_PER_HOUR = 3;
export const DIAGNOSTICS_MAX_PER_USER_PER_DAY = 10;
const TELEGRAM_CAPTION_MAX_CHARS = 1024;

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

const REDACTED = "<redacted>";
const RULES: Array<[RegExp, string]> = [
  // Secrets first, so a later rule cannot leave half a key behind.
  [/(x-api-key\s*[:=]\s*)\S+/gi, `$1${REDACTED}`],
  [/(\bapi[_-]?key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, `$1${REDACTED}`],
  [/(\bbearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`],
  [/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, `<bot-token>`],
  [
    /(\b(?:link[_-]?code|token|password|secret)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
    `$1${REDACTED}`,
  ],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>"],
  // GPS is not needed for diagnosis (owner, 2026-10-21): drop every coordinate form.
  [
    /(\b(?:lat|lon|lng|latitude|longitude)["']?\s*[:=]\s*["']?)-?\d+(?:\.\d+)?/gi,
    "$1<gps>",
  ],
  [/\bgeo:\S*/gi, "geo:<gps>"],
  [/-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/g, "<gps>"],
  // VIN: 17 chars, no I/O/Q. Keep the last 6 so one car's reports can still be matched.
  [/\b[A-HJ-NPR-Z0-9]{11}([A-HJ-NPR-Z0-9]{6})\b/g, "VIN…$1"],
];

/**
 * Server-side redaction, applied even though Mate redacts before upload: an old or buggy
 * APK must not be able to put a key or a location into the developer's chat.
 */
export function redactDiagnosticsText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES)
    out = out.replace(pattern, replacement);
  return out;
}

export type DiagnosticsRateVerdict =
  { ok: true } | { ok: false; reason: "vehicle_hourly" | "user_daily" };

export function diagnosticsRateVerdict(counts: {
  vehicleLastHour: number;
  userLastDay: number;
}): DiagnosticsRateVerdict {
  if (counts.vehicleLastHour >= DIAGNOSTICS_MAX_PER_VEHICLE_PER_HOUR)
    return { ok: false, reason: "vehicle_hourly" };
  if (counts.userLastDay >= DIAGNOSTICS_MAX_PER_USER_PER_DAY)
    return { ok: false, reason: "user_daily" };
  return { ok: true };
}

/** Free text from the user, trimmed and capped; empty → null. */
export function normalizeDiagnosticsComment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > DIAGNOSTICS_MAX_COMMENT_CHARS
    ? `${trimmed.slice(0, DIAGNOSTICS_MAX_COMMENT_CHARS)}…`
    : trimmed;
}

/** Mate build string as reported by the APK; anything that is not a short version is dropped. */
export function normalizeMateVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9A-Za-z.+-]{1,32}$/.test(trimmed) ? trimmed : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function diagnosticsFileName(vehicleId: string, at: Date): string {
  const safeVehicle =
    vehicleId.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40) || "vehicle";
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `diagnostics-${safeVehicle}-${stamp}.txt.gz`;
}

/**
 * Telegram document caption (HTML, Bot API cap 1024 chars). No e-mail: the user id is enough
 * to find the account, and the chat is not an access-controlled store.
 */
export function diagnosticsCaption(data: {
  carName: string | null;
  vehicleId: string;
  userId: string;
  mateVersion: string | null;
  comment: string | null;
  bytes: number;
}): string {
  const lines = [
    `🛠 <b>Диагностика</b> · ${escapeHtml(data.carName ?? "—")} (<code>${escapeHtml(data.vehicleId)}</code>)`,
    `👤 <code>${escapeHtml(data.userId)}</code>`,
    `📱 Mate ${escapeHtml(data.mateVersion ?? "?")} · ${Math.max(1, Math.round(data.bytes / 1024))} KB`,
  ];
  const base = lines.join("\n");
  if (!data.comment) return base;
  // Shorten the raw comment, never the HTML: a cut inside a tag or entity is a parse error.
  let comment = data.comment;
  let caption = `${base}\n💬 ${escapeHtml(comment)}`;
  while (caption.length > TELEGRAM_CAPTION_MAX_CHARS && comment.length > 0) {
    comment = comment.slice(0, -10);
    caption = `${base}\n💬 ${escapeHtml(comment)}…`;
  }
  return caption;
}
