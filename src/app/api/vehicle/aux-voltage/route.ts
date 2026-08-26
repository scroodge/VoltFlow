import { NextRequest, NextResponse } from "next/server";

import { resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";
import { mapAuxVoltageDailyRows, type AuxVoltageDailyRow } from "@/lib/voltflowmate/aux-voltage-history";

export async function GET(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const vehicleId = request.nextUrl.searchParams.get("vehicle_id")?.trim();
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  if (!vehicleId || !from || !to || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) {
    return NextResponse.json({ error: "vehicle_id, from and to are required" }, { status: 400 });
  }

  const { data, error } = await access.supabase.rpc("bydmate_aux_voltage_daily", {
    p_user_id: access.userId,
    p_vehicle_id: vehicleId,
    p_from: from,
    p_to: to,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: mapAuxVoltageDailyRows((data ?? []) as AuxVoltageDailyRow[]) });
}
