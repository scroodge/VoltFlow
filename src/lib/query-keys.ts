export const queryKeys = {
  cars: ["cars"] as const,
  sessions: ["sessions"] as const,
  session: (id: string) => ["session", id] as const,
  profile: ["profile"] as const,
  bydmateLive: ["bydmate-live"] as const,
  bydmateLatestTrips: (vehicleId: string | null, limit: number, lite = false) =>
    ["bydmate-latest-trips", vehicleId, limit, lite] as const,
  bydmateTrips: (date: string, vehicleId: string | null) =>
    ["bydmate-trips", date, vehicleId] as const,
  bydmateTripSamples: (tripId: string) => ["bydmate-trip-samples", tripId] as const,
  bydmateChargingSessionSamples: (sessionId: string, vehicleId: string) =>
    ["bydmate-charging-session-samples", sessionId, vehicleId] as const,
  bydmateTripTrack: (tripId: string) => ["bydmate-trip-track", tripId] as const,
  bydmateTelemetryHistory: (range: string, date: string, vehicleId: string | null) =>
    ["bydmate-telemetry-history", range, date, vehicleId] as const,
  bydmateTelemetryPoints: ["bydmate-telemetry-points"] as const,
};
