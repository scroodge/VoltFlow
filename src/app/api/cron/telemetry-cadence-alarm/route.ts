import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram/bot-send";

type AlarmRow = {
  id: string;
  user_id: string;
  vehicle_id: string;
  signal: "moving_gap" | "low_24h_count";
  observed_at: string;
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
    .select("id,user_id,vehicle_id,signal,observed_at,gap_seconds,sample_count_24h,notified_at,resolved_at")
    .eq("id", alarmId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const alarm = data as AlarmRow | null;
  // The random audit UUID is a single-use capability minted only by the database
  // detector. Unknown, delivered, and recovered alarms reveal no user information.
  if (!alarm || alarm.notified_at || alarm.resolved_at) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("telegram_id")
    .eq("id", alarm.user_id)
    .maybeSingle();
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });

  if (profile?.telegram_id == null) {
    await supabase
      .from("bydmate_telemetry_cadence_alarm_audits")
      .update({ delivery_error: "missing_telegram_id" })
      .eq("id", alarm.id)
      .is("notified_at", null);
    return NextResponse.json({ ok: false, error: "missing_telegram_id" }, { status: 207 });
  }

  const detail = alarm.signal === "moving_gap"
    ? `Moving samples were ${Math.round(Number(alarm.gap_seconds))} seconds apart.`
    : `Only ${alarm.sample_count_24h ?? 0} telemetry samples arrived in 24 hours.`;
  const delivery = await sendTelegramMessage(
    profile.telegram_id,
    `⚠️ VoltFlow telemetry cadence collapsed for ${alarm.vehicle_id}.\n${detail}\nObserved: ${alarm.observed_at}`,
  );

  const update = delivery.ok
    ? { notified_at: new Date().toISOString(), delivery_error: null }
    : { delivery_error: delivery.error };
  const { error: updateError } = await supabase
    .from("bydmate_telemetry_cadence_alarm_audits")
    .update(update)
    .eq("id", alarm.id)
    .is("notified_at", null)
    .is("resolved_at", null);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: delivery.ok }, { status: delivery.ok ? 200 : 207 });
}
