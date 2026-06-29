import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TelegramUpdate = {
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
};

export async function POST(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 500 });
  }

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (
    webhookSecret &&
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

  const chatId = update.message?.chat?.id;
  if (!chatId) return NextResponse.json({ ok: true });

  const text = update.message?.text?.trim() ?? "";
  if (text.startsWith("/start") || text.startsWith("/app") || text === "") {
    await sendTelegramMessage(botToken, chatId);
  }

  return NextResponse.json({ ok: true });
}

async function sendTelegramMessage(botToken: string, chatId: number | string) {
  const webAppUrl =
    process.env.TELEGRAM_WEB_APP_URL ??
    withPath(process.env.NEXT_PUBLIC_SITE_URL, "/telegram") ??
    "https://volt-flow-beige.vercel.app/telegram";

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
        ],
      },
      disable_web_page_preview: true,
    }),
  }).catch(() => undefined);
}

function withPath(base: string | undefined, path: string) {
  if (!base) return null;
  return `${base.replace(/\/$/, "")}${path}`;
}
