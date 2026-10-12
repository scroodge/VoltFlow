import { NextResponse } from "next/server";

import { siteUrl } from "@/lib/site-url";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  answerTelegramCallback,
  deleteTelegramMessage,
} from "@/lib/telegram/bot-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TelegramUpdate = {
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
  callback_query?: {
    id?: string;
    data?: string;
    message?: {
      message_id?: number;
      chat?: { id?: number | string };
    };
    from?: { id?: number };
  };
};

export async function POST(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 500 });
  }

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 500 });
  }
  if (
    request.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret
  ) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return NextResponse.json({ ok: true });
  }

  const chatId = update.message?.chat?.id;
  if (!chatId) return NextResponse.json({ ok: true });

  const text = update.message?.text?.trim() ?? "";
  if (text.startsWith("/start") || text.startsWith("/app") || text === "") {
    await sendTelegramMessage(botToken, chatId);
  }

  return NextResponse.json({ ok: true });
}

async function handleCallbackQuery(
  cq: NonNullable<TelegramUpdate["callback_query"]>,
) {
  const queryId = cq.id;
  const data = cq.data;

  if (data === "lw:hide") {
    const chatId = cq.message?.chat?.id;
    const messageId = cq.message?.message_id;
    if (typeof chatId !== "number" || messageId == null) {
      await answerTelegramCallback(queryId ?? "");
      return;
    }
    await deleteTelegramMessage(chatId, messageId);
    await getSupabaseAdmin()
      .from("telegram_live_messages")
      .update({ status: "hidden" })
      .eq("chat_id", chatId)
      .eq("message_id", messageId);
    await answerTelegramCallback(queryId ?? "", "Скрыто. /start — вернуть виджет", true);
    return;
  }

  if (data === "lw:show") {
    const telegramId = cq.from?.id;
    if (typeof telegramId !== "number") {
      await answerTelegramCallback(queryId ?? "");
      return;
    }
    const supabase = getSupabaseAdmin();
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    if (!profile) {
      await answerTelegramCallback(queryId ?? "", "Telegram не привязан к аккаунту VoltFlow", true);
      return;
    }
    // Drop the tracked messages so the next ingest recreates fresh widgets.
    // Active rows are deleted on Telegram first — after a client-side history
    // clear the bot still owns an invisible copy the user can never remove.
    const { data: rows } = await supabase
      .from("telegram_live_messages")
      .select("chat_id,message_id,status")
      .eq("user_id", profile.id);
    for (const row of rows ?? []) {
      if (row.status === "active") {
        await deleteTelegramMessage(row.chat_id, row.message_id).catch(() => undefined);
      }
    }
    await supabase
      .from("telegram_live_messages")
      .delete()
      .eq("user_id", profile.id);
    await answerTelegramCallback(queryId ?? "", "Виджет появится с ближайшей телеметрией", true);
  }
}

async function sendTelegramMessage(botToken: string, chatId: number | string) {
  const webAppUrl = process.env.TELEGRAM_WEB_APP_URL ?? siteUrl("/telegram");

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "VoltFlow готов. Откройте приложение, чтобы смотреть зарядку, поездки и сервис BYD.",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Открыть VoltFlow",
              web_app: { url: webAppUrl },
            },
          ],
          [
            {
              text: "Показать виджет",
              callback_data: "lw:show",
            },
          ],
        ],
      },
      disable_web_page_preview: true,
    }),
  }).catch(() => undefined);
}
