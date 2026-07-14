"use client";

/**
 * Telegram auth/webhook traffic may need to run outside Vercel when Vercel
 * serves a Security Checkpoint before Next.js routes execute.
 */
export function telegramApiUrl(path: string) {
  const base =
    process.env.NEXT_PUBLIC_TELEGRAM_API_BASE_URL?.trim() ??
    "https://bot.voltflow.life/voltflow";
  if (!base) return path;
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}
