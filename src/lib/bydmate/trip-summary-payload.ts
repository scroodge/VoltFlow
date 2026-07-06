import { z } from "zod";

// Per-trip aggregates imported from a BYD model's own trip log (energydata
// SQLite), read by VoltFlow Mate without ADB. No telemetry samples, no GPS
// track, no SOC -- see supabase/TELEMETRY.md and BACKLOG "energydata
// trip-summary cloud sync". Timestamps are epoch seconds, matching the
// EnergyConsumption.start_timestamp/end_timestamp columns.
const tripSummarySchema = z
  .object({
    start_timestamp: z.number().int().positive(),
    end_timestamp: z.number().int().positive(),
    distance_km: z.number().min(0).max(2000),
    energy_kwh: z.number().min(0).max(500),
    duration_seconds: z.number().int().min(0).max(24 * 60 * 60).optional(),
  })
  .refine((trip) => trip.end_timestamp >= trip.start_timestamp, {
    message: "end_timestamp must be >= start_timestamp",
  });

export type TripSummaryPayload = z.infer<typeof tripSummarySchema>;

const tripSummaryBatchSchema = z.array(tripSummarySchema).min(1).max(300);

export function parseTripSummaryBatch(json: unknown) {
  return tripSummaryBatchSchema.safeParse(json);
}
