#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { processBydmateVehicleStateNotifications } from "../src/lib/push/vehicle-state-notifications.ts";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const userId = "4e5c7688-8e10-43b2-b562-81fe3d3d6788";
const now = new Date().toISOString();

// Clear state first
await supabase
  .from("bydmate_vehicle_state_notifications")
  .delete()
  .eq("user_id", userId)
  .eq("vehicle_id", "way");

console.log("State cleared");

// Send a parked+charging sample
const result = await processBydmateVehicleStateNotifications({
  supabase,
  userId,
  samples: [{
    schema_version: 1,
    vehicle_id: "way",
    device_time: now,
    source: "BYDMate",
    telemetry: {
      soc: 70,
      speed_kmh: 0,
      is_charging: true,
      is_parked: true,
      charge_power_kw: 4,
      odometer_km: 40761,
    },
    diplus: { gear: 1 },
    location: { lat: 53.94527, lon: 27.35321 },
  }],
  receivedAt: now,
});

console.log("Result:", JSON.stringify(result));
