import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isLocale, type Locale } from "@/lib/i18n";
import { resolveAuxBatteryChemistry, type AuxBatteryChemistry } from "@/lib/vehicle/aux-battery-chemistry";
import { mapAuxVoltageDailyRows } from "@/lib/voltflowmate/aux-voltage-history";
import { evaluateAuxBatteryAlerts } from "@/lib/voltflowmate/aux-battery-alerts";
import { sendAuxBatteryNotification } from "@/lib/push/aux-battery-notifications";
import type { CarGeneration } from "@/lib/car-generations";

const CRON_SECRET = process.env.CRON_SECRET ?? "";

type ProfileRow = { id: string; preferred_locale: string | null; notify_channel: string | null; telegram_id: number | string | null };
type CarRow = { user_id: string; vehicle_alias: string | null; model_generation: CarGeneration | null; battery_chemistry: AuxBatteryChemistry | null };
type StateRow = { user_id: string; vehicle_id: string; acute_episode_active: boolean; last_digest_at: string | null };

function channel(value: string | null): "web_push" | "telegram" | "both" {
  return value === "telegram" || value === "both" ? value : "web_push";
}

export async function POST(request: NextRequest) {
  if (!CRON_SECRET || request.headers.get("x-cron-secret") !== CRON_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const completedThrough = new Date();
  completedThrough.setUTCHours(0, 0, 0, 0);
  completedThrough.setUTCMilliseconds(-1);
  const from = new Date(completedThrough.getTime() - 89 * 86_400_000).toISOString();
  const [{ data: profiles, error: profileError }, { data: cars, error: carError }, { data: states, error: stateError }] = await Promise.all([
    supabase.from("profiles").select("id,preferred_locale,notify_channel,telegram_id").eq("aux_battery_alerts_enabled", true),
    supabase.from("cars").select("user_id,vehicle_alias,model_generation,battery_chemistry").not("vehicle_alias", "is", null),
    supabase.from("bydmate_aux_battery_alert_state").select("user_id,vehicle_id,acute_episode_active,last_digest_at"),
  ]);
  const loadError = profileError ?? carError ?? stateError;
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });

  const profilesById = new Map((profiles as ProfileRow[]).map((profile) => [profile.id, profile]));
  const statesByVehicle = new Map((states as StateRow[]).map((state) => [`${state.user_id}:${state.vehicle_id}`, state]));
  const result = { evaluated: 0, acute: 0, digests: 0, sent: 0, errors: [] as string[] };

  for (const car of cars as CarRow[]) {
    const profile = profilesById.get(car.user_id);
    if (!profile || !car.vehicle_alias) continue;
    try {
      const { data, error } = await supabase.rpc("bydmate_aux_voltage_daily", {
        p_user_id: car.user_id, p_vehicle_id: car.vehicle_alias, p_from: from, p_to: completedThrough.toISOString(),
      });
      if (error) throw error;
      const previous = statesByVehicle.get(`${car.user_id}:${car.vehicle_alias}`);
      const decision = evaluateAuxBatteryAlerts({
        points: mapAuxVoltageDailyRows(data ?? []),
        chemistry: resolveAuxBatteryChemistry(car.battery_chemistry, car.model_generation),
        state: { acuteEpisodeActive: previous?.acute_episode_active ?? false, lastDigestAt: previous?.last_digest_at ?? null },
        now,
      });
      result.evaluated += 1;

      // Claim the episode/digest before transport. A retry or concurrent job therefore
      // cannot turn a transient delivery error into duplicate audible notifications.
      const { error: upsertError } = await supabase.from("bydmate_aux_battery_alert_state").upsert({
        user_id: car.user_id,
        vehicle_id: car.vehicle_alias,
        acute_episode_active: decision.nextState.acuteEpisodeActive,
        last_digest_at: decision.nextState.lastDigestAt,
      }, { onConflict: "user_id,vehicle_id" });
      if (upsertError) throw upsertError;

      const kind = decision.sendAcute ? "acute" : decision.sendDigest ? "digest" : null;
      if (!kind || decision.latestVoltage == null) continue;
      const delivery = await sendAuxBatteryNotification({
        supabase, userId: car.user_id, channel: channel(profile.notify_channel), telegramId: profile.telegram_id,
        locale: (typeof profile.preferred_locale === "string" && isLocale(profile.preferred_locale) ? profile.preferred_locale : "en") as Locale,
        notification: { kind, vehicleId: car.vehicle_alias, voltage: decision.latestVoltage, baseline: decision.baseline },
      });
      result[kind === "acute" ? "acute" : "digests"] += 1;
      result.sent += delivery.sent;
    } catch (error) {
      result.errors.push(`${car.user_id}:${car.vehicle_alias}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return NextResponse.json({ ok: result.errors.length === 0, ...result }, { status: result.errors.length ? 207 : 200 });
}
