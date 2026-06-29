import "server-only";

/**
 * Send a message to a Telegram user via the Bot API.
 *
 * This is the notification transport for Telegram users — the equivalent of
 * `sendPushToUser` (web push) in `src/lib/push/web-push.ts`. It is a plain
 * HTTPS call to api.telegram.org using `TELEGRAM_BOT_TOKEN`, so no separate bot
 * server is required.
 *
 * Note: Telegram only delivers to users who have started / interacted with the
 * bot. A 403 ("bot was blocked" / "chat not found") means the user must press
 * Start once — callers should treat that as a soft failure, not an error.
 */

export type TelegramSendResult =
  | { ok: true }
  | { ok: false; error: string; blocked?: boolean };

type SendOptions = {
  parseMode?: "HTML" | "MarkdownV2";
  /** Inline keyboard / reply markup, passed through verbatim to the Bot API. */
  replyMarkup?: unknown;
  disableNotification?: boolean;
};

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options: SendOptions = {},
): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "missing_bot_token" };

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options.parseMode,
        reply_markup: options.replyMarkup,
        disable_notification: options.disableNotification,
        disable_web_page_preview: true,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; description?: string; error_code?: number }
      | null;

    if (response.ok && payload?.ok) return { ok: true };

    const description = payload?.description ?? `http_${response.status}`;
    const blocked = response.status === 403 || /blocked|chat not found/i.test(description);
    return { ok: false, error: description, blocked };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "fetch_failed" };
  }
}
