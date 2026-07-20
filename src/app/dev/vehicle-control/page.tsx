import { notFound } from "next/navigation";

import { DEV_WAY_VEHICLE_ID } from "@/lib/dev/way-context";

import { VehicleControlDevClient } from "./VehicleControlDevClient";

export const dynamic = "force-dynamic";

export default async function VehicleControlDevPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const vehicleId = DEV_WAY_VEHICLE_ID;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  const telemetryEndpoint = `${siteUrl}/api/bydmate/telemetry`;

  return (
    <main className="safe-bottom px-4 pb-8 pt-5">
      <VehicleControlDevClient
        vehicleId={vehicleId}
        apiKey={null}
        telemetryEndpoint={telemetryEndpoint}
      />
    </main>
  );
}
