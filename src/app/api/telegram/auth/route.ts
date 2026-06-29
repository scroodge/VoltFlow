import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTelegramInitData } from "@/lib/telegram/verify-init-data";

// node:crypto (HMAC verify) requires the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram Mini App login (full login + auto-link).
 *
 * Body: { initData: string }  — the validated `window.Telegram.WebApp.initData`.
 *
 * Flow:
 *   1. Verify the initData HMAC with TELEGRAM_BOT_TOKEN.
 *   2. Resolve the VoltFlow account: by profiles.telegram_id, else by the
 *      deterministic email, else create one (the handle_new_user trigger seeds
 *      the profiles row). Always (re)link telegram_id / username.
 *   3. Mint a Supabase session (admin magiclink -> verifyOtp) and return the
 *      tokens. The client calls supabase.auth.setSession(...) — matching the
 *      app's client-side, no-middleware auth model.
 */
export async function POST(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!botToken || !url || !anonKey) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 500 });
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

  const tg = verified.user;
  const email = `tg_${tg.id}@telegram.voltflow`;
  const username = tg.username ?? null;

  // 1. Resolve the account by linked telegram_id.
  const { data: linked, error: linkedErr } = await supabaseAdmin
    .from("profiles")
    .select("id, email")
    .eq("telegram_id", tg.id)
    .maybeSingle();
  if (linkedErr) {
    return NextResponse.json({ ok: false, error: "lookup_failed" }, { status: 500 });
  }

  let userId: string;
  let userEmail: string;

  if (linked) {
    userId = linked.id;
    userEmail = linked.email ?? email;
  } else {
    // 2a. Re-link edge case: a tg_* account exists but lost its telegram_id.
    const { data: byEmail } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .eq("email", email)
      .maybeSingle();

    if (byEmail) {
      userId = byEmail.id;
      userEmail = byEmail.email ?? email;
    } else {
      // 2b. Create a fresh account. The on_auth_user_created trigger inserts
      // the matching profiles row.
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          telegram_id: tg.id,
          telegram_username: username,
          full_name: [tg.first_name, tg.last_name].filter(Boolean).join(" ") || undefined,
        },
      });
      if (createErr || !created?.user) {
        return NextResponse.json({ ok: false, error: "create_failed" }, { status: 500 });
      }
      userId = created.user.id;
      userEmail = email;
    }

    // Link telegram identity onto the profile (service role bypasses RLS).
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ telegram_id: tg.id, telegram_username: username })
      .eq("id", userId);
    if (updateErr) {
      return NextResponse.json({ ok: false, error: "link_failed" }, { status: 500 });
    }
  }

  // 3. Mint a session: generate a magiclink (no email is sent) then redeem the
  // OTP server-side to obtain access/refresh tokens for the client.
  const { data: link, error: genErr } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: userEmail,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (genErr || !tokenHash) {
    return NextResponse.json({ ok: false, error: "session_failed" }, { status: 500 });
  }

  const redeemClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: verifyErr } = await redeemClient.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyErr || !session?.session) {
    return NextResponse.json({ ok: false, error: "verify_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token,
    telegram_id: tg.id,
  });
}
