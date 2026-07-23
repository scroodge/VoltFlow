import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { DEV_WAY_VEHICLE_ID, resolveWayDevContext } from "@/lib/dev/way-context";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type VehicleApiAccess = {
  userId: string;
  supabase: SupabaseClient;
  devMode: boolean;
};

export function isDevApiRequest(request: NextRequest): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (
    request.nextUrl.searchParams.get("dev") === "1" ||
    request.headers.get("x-voltflow-dev-auth-bypass") === "1"
  );
}

export async function resolveVehicleApiAccess(
  request: NextRequest,
): Promise<VehicleApiAccess | null> {
  if (isDevApiRequest(request)) {
    const service = createServiceClient();
    const way = await resolveWayDevContext(service, DEV_WAY_VEHICLE_ID);
    if (!way.appUserId) return null;
    return { userId: way.appUserId, supabase: service, devMode: true };
  }

  const supabase = await createClient();
  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData.user) return null;
  return { userId: userData.user.id, supabase, devMode: false };
}

export function devVehicleId(request: NextRequest): string | null {
  const requested = request.nextUrl.searchParams.get("vehicle_id")?.trim();
  if (requested) return requested;
  return isDevApiRequest(request) ? DEV_WAY_VEHICLE_ID : null;
}
