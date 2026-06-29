import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyTelegramInitData } from "@/lib/telegram/verify-init-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Link a Telegram identity to an already-authenticated VoltFlow account.
 *
 * Used when an existing PWA user opens the Mini App and taps "Already have
 * account?" → logs in with email/password → lands back at /telegram →
 * TelegramEntryGate calls this endpoint to stamp telegram_id onto their
 * existing profile row. Idempotent — safe to call on every authenticated
 * Mini App open.
 *
 * Body: { initData: string }
 * Auth: Supabase session cookie, or Authorization: Bearer <access_token>.
 */
export async function POST(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 500 });
  }

  const bearerToken = readBearerToken(request);
  const supabase = await createClient();
  const {
    data: { user: cookieUser },
    error: userErr,
  } = await supabase.auth.getUser();

  const bearerUser =
    cookieUser || !bearerToken
      ? null
      : (await supabaseAdmin.auth.getUser(bearerToken)).data.user;
  const user = cookieUser ?? bearerUser;

  if ((userErr && !bearerToken) || !user) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  let body: { initData?: unknown };
  try {
    body = (await request.json()) as { initData?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const initData = typeof body.initData === "string" ? body.initData : "";
  const verified = verifyTelegramInitData(initData, botToken);
  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: verified.error }, { status: 401 });
  }

  const { error: updateErr } = await supabaseAdmin
    .from("profiles")
    .update({
      telegram_id: verified.user.id,
      telegram_username: verified.user.username ?? null,
    })
    .eq("id", user.id);

  if (updateErr) {
    return NextResponse.json({ ok: false, error: "link_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, telegram_id: verified.user.id });
}

function readBearerToken(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1] ?? null;
}
