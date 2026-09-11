import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram/bot-send";
import { cadenceAlarmMessage } from "@/lib/telegram/cadence-alarm-message";

type AlarmRow = {
  id: string;
  user_id: string;
  vehicle_id: string;
  signal: "moving_gap" | "low_24h_count";
  observed_at: string;
  previous_moving_at: string | null;
  gap_seconds: number | null;
  sample_count_24h: number | null;
  notified_at: string | null;
  resolved_at: string | null;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { alarm_id?: unknown } | null;
  const alarmId = typeof body?.alarm_id === "string" ? body.alarm_id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(alarmId)) {
    return NextResponse.json({ error: "Invalid alarm id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("bydmate_telemetry_cadence_alarm_audits")
    .select("id,user_id,vehicle_id,signal,observed_at,previous_moving_at,gap_seconds,sample_count_24h,notified_at,resolved_at")
    .eq("id", alarmId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const alarm = data as AlarmRow | null;
  // The random audit UUID is a single-use capability minted only by the database
  // detector. Unknown, delivered, and recovered alarms reveal no user information.
  if (!alarm || alarm.notified_at || alarm.resolved_at) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Operator alarm: the owner cannot act on a sender fault, so it goes to the admins.
  const { data: admins, error: adminsError } = await supabase.from("admin_users").select("user_id");
  if (adminsError) return NextResponse.json({ error: adminsError.message }, { status: 500 });
  const adminIds = (admins ?? []).map((row) => row.user_id as string);

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id,email,telegram_id")
    .in("id", [...adminIds, alarm.user_id]);
  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });

  const ownerEmail = (profiles ?? []).find((row) => row.id === alarm.user_id)?.email ?? null;
  const adminChatIds = (profiles ?? [])
    .filter((row) => adminIds.includes(row.id) && row.telegram_id != null)
    .map((row) => row.telegram_id as number | string);

  if (adminChatIds.length === 0) {
    await supabase
      .from("bydmate_telemetry_cadence_alarm_audits")
      .update({ delivery_error: "no_admin_telegram" })
      .eq("id", alarm.id)
      .is("notified_at", null);
    return NextResponse.json({ ok: false, error: "no_admin_telegram" }, { status: 207 });
  }

  const text = cadenceAlarmMessage(alarm, ownerEmail);
  const deliveries = await Promise.all(adminChatIds.map((chatId) => sendTelegramMessage(chatId, text)));
  const failure = deliveries.find((delivery) => !delivery.ok);
  const delivered = deliveries.some((delivery) => delivery.ok);

  const update = delivered
    ? { notified_at: new Date().toISOString(), delivery_error: null }
    : { delivery_error: failure && !failure.ok ? failure.error : "send_failed" };
  const { error: updateError } = await supabase
    .from("bydmate_telemetry_cadence_alarm_audits")
    .update(update)
    .eq("id", alarm.id)
    .is("notified_at", null)
    .is("resolved_at", null);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: delivered }, { status: delivered ? 200 : 207 });
}
