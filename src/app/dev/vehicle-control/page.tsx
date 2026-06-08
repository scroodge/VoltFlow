import { notFound } from "next/navigation";

import { DEV_WAY_VEHICLE_ID, resolveWayDevContext } from "@/lib/dev/way-context";
import { createServiceClient } from "@/lib/supabase/service";

import { VehicleControlDevClient } from "./VehicleControlDevClient";

export const dynamic = "force-dynamic";

export default async function VehicleControlDevPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const vehicleId = DEV_WAY_VEHICLE_ID;
  const supabase = createServiceClient();
  const way = await resolveWayDevContext(supabase, vehicleId);

  let apiKey: string | null = null;
  if (way.appUserId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("bydmate_cloud_api_key")
      .eq("id", way.appUserId)
      .maybeSingle();
    apiKey =
      typeof profile?.bydmate_cloud_api_key === "string"
        ? profile.bydmate_cloud_api_key
        : null;
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  const telemetryEndpoint = `${siteUrl}/api/bydmate/telemetry`;

  return (
    <main className="safe-bottom px-4 pb-8 pt-5">
      <VehicleControlDevClient
        vehicleId={vehicleId}
        apiKey={apiKey}
        telemetryEndpoint={telemetryEndpoint}
      />
    </main>
  );
}
