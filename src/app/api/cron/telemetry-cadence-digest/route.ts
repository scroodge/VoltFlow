import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram/bot-send";
import {
  cadenceDigestMessage,
  groupCadenceDigestAlarms,
} from "@/lib/telegram/cadence-digest-message";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AlarmRow = {
  id: string;
  user_id: string;
  vehicle_id: string;
  signal: "moving_gap" | "low_24h_count";
  observed_at: string;
  gap_seconds: number | null;
  sample_count_24h: number | null;
  notified_at: string | null;
};

/**
 * Once-daily digest for cadence-collapse alarms the detector's 24h per-tuple cooldown
 * left undelivered (see migration `20260924100000`). Mirrors
 * `telemetry-cadence-alarm/route.ts`'s admin-only delivery, but for a batch of ids
 * instead of one, grouped by (user_id, vehicle_id, signal) before sending.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    alarm_ids?: unknown;
  } | null;
  const alarmIds = Array.isArray(body?.alarm_ids)
    ? body.alarm_ids.filter(
        (id): id is string => typeof id === "string" && UUID_RE.test(id),
      )
    : [];
  if (alarmIds.length === 0) {
    return NextResponse.json({ error: "Invalid alarm_ids" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("bydmate_telemetry_cadence_alarm_audits")
    .select(
      "id,user_id,vehicle_id,signal,observed_at,gap_seconds,sample_count_24h,notified_at",
    )
    .in("id", alarmIds);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Another digest run or the per-alarm immediate path may have already delivered some
  // of these ids between enqueue and this call; only act on what's still pending.
  const alarms = ((data ?? []) as AlarmRow[]).filter((row) => !row.notified_at);
  if (alarms.length === 0) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const { data: admins, error: adminsError } = await supabase
    .from("admin_users")
    .select("user_id");
  if (adminsError)
    return NextResponse.json({ error: adminsError.message }, { status: 500 });
  const adminIds = (admins ?? []).map((row) => row.user_id as string);

  const relevantIds = [
    ...new Set([...adminIds, ...alarms.map((row) => row.user_id)]),
  ];
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id,email,telegram_id")
    .in("id", relevantIds);
  if (profilesError)
    return NextResponse.json({ error: profilesError.message }, { status: 500 });

  const ownerEmailByUserId = new Map(
    (profiles ?? []).map((row) => [
      row.id as string,
      row.email as string | null,
    ]),
  );
  const adminChatIds = (profiles ?? [])
    .filter((row) => adminIds.includes(row.id) && row.telegram_id != null)
    .map((row) => row.telegram_id as number | string);

  const includedIds = alarms.map((row) => row.id);

  if (adminChatIds.length === 0) {
    await supabase
      .from("bydmate_telemetry_cadence_alarm_audits")
      .update({ delivery_error: "no_admin_telegram" })
      .in("id", includedIds)
      .is("notified_at", null);
    return NextResponse.json(
      { ok: false, error: "no_admin_telegram" },
      { status: 207 },
    );
  }

  const groups = groupCadenceDigestAlarms(alarms);
  const text = cadenceDigestMessage(groups, ownerEmailByUserId);
  const deliveries = await Promise.all(
    adminChatIds.map((chatId) => sendTelegramMessage(chatId, text)),
  );
  const failure = deliveries.find((delivery) => !delivery.ok);
  const delivered = deliveries.some((delivery) => delivery.ok);

  const update = delivered
    ? { notified_at: new Date().toISOString(), delivery_error: null }
    : {
        delivery_error: failure && !failure.ok ? failure.error : "send_failed",
      };
  const { error: updateError } = await supabase
    .from("bydmate_telemetry_cadence_alarm_audits")
    .update(update)
    .in("id", includedIds)
    .is("notified_at", null);
  if (updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json(
    { ok: delivered, alarm_count: includedIds.length },
    { status: delivered ? 200 : 207 },
  );
}
