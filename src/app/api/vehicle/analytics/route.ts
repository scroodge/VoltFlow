import { NextRequest, NextResponse } from "next/server";

import {
  fetchPeriodTripsEnriched,
  fetchRouteInsights,
} from "@/lib/bydmate/route-insights";
import {
  fetchCostPerKm,
  fetchMonthlyStats,
  fetchPhantomDrain,
} from "@/lib/vehicle-analytics";
import { devVehicleId, resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";

export async function GET(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const type = params.get("type") ?? "monthly";
  const vehicleId = params.get("vehicle_id")?.trim() || devVehicleId(request);

  try {
    if (type === "monthly") {
      const month = params.get("month") ?? new Date().toISOString().slice(0, 7);
      const stats = await fetchMonthlyStats({
        supabase: access.supabase,
        userId: access.userId,
        vehicleId,
        monthKey: month,
      });
      return NextResponse.json(stats);
    }

    if (type === "phantom") {
      const days = Number(params.get("days") ?? "14");
      const rows = await fetchPhantomDrain({
        supabase: access.supabase,
        userId: access.userId,
        vehicleId,
        days: Number.isFinite(days) ? days : 14,
      });
      return NextResponse.json({ rows });
    }

    if (type === "cost-per-km") {
      const fromDate = params.get("from") ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const toDate = params.get("to") ?? new Date().toISOString().slice(0, 10);
      const summary = await fetchCostPerKm({
        supabase: access.supabase,
        userId: access.userId,
        vehicleId,
        fromDate,
        toDate,
      });
      return NextResponse.json(summary);
    }

    if (type === "period-trips") {
      const from = params.get("from");
      const to = params.get("to");
      if (!from || !to) {
        return NextResponse.json({ error: "Missing from/to" }, { status: 400 });
      }
      const trips = await fetchPeriodTripsEnriched({
        supabase: access.supabase,
        userId: access.userId,
        vehicleId,
        from,
        to,
      });
      return NextResponse.json({ trips });
    }

    if (type === "route-insights") {
      const outsideTemp = params.get("outside_temp");
      const parsedTemp = outsideTemp != null ? Number(outsideTemp) : null;
      const routes = await fetchRouteInsights({
        supabase: access.supabase,
        userId: access.userId,
        vehicleId,
        currentOutsideTempC: Number.isFinite(parsedTemp) ? parsedTemp : null,
      });
      return NextResponse.json({ routes });
    }

    return NextResponse.json({ error: "Unknown analytics type" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Failed to load analytics" }, { status: 500 });
  }
}
