#!/usr/bin/env node
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { updateTelegramLiveWidgets } from "../src/lib/telegram/live-widget.js";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const userId = "4e5c7688-8e10-43b2-b562-81fe3d3d6788";
  const phase = process.argv[2] ?? "charging";
  const now = new Date().toISOString();

  const samples = [{
    schema_version: 1 as const,
    vehicle_id: "way",
    device_time: now,
    source: "BYDMate" as const,
    telemetry: (() => {
      switch (phase) {
        case "driving":
          return { soc: 68, speed_kmh: 45, is_charging: false, is_parked: false, charge_power_kw: 0, odometer_km: 40770 };
        case "parked":
          return { soc: 72, speed_kmh: 0, is_charging: false, is_parked: true, charge_power_kw: 0, odometer_km: 40765 };
        default:
          return { soc: 70, speed_kmh: 0, is_charging: true, is_parked: true, charge_power_kw: 4.6, odometer_km: 40761 };
      }
    })(),
    diplus: { gear: phase === "driving" ? 4 : 1 },
    location: { lat: 53.94527, lon: 27.35321 },
  }];

  console.log(`Sending test live widget (${phase})...`);
  const result = await updateTelegramLiveWidgets({ supabase, userId, samples, receivedAt: now });
  console.log("Result:", JSON.stringify(result));
}

main().catch(console.error);
