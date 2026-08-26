export const queryKeys = {
  cars: ["cars"] as const,
  sessions: ["sessions"] as const,
  session: (id: string) => ["session", id] as const,
  profile: ["profile"] as const,
  voltflowMateLive: ["bydmate-live"] as const,
  voltflowMateLatestTrips: (vehicleId: string | null, limit: number, lite = false) =>
    ["bydmate-latest-trips", vehicleId, limit, lite] as const,
  voltflowMateTrips: (date: string, vehicleId: string | null) =>
    ["bydmate-trips", date, vehicleId] as const,
  voltflowMateTripMonthDates: (year: number, month: number, vehicleId: string | null) =>
    ["bydmate-trip-month-dates", year, month, vehicleId] as const,
  voltflowMateTripSamples: (tripId: string) => ["bydmate-trip-samples", tripId] as const,
  voltflowMateChargingSessionSamples: (sessionId: string, vehicleId: string) =>
    ["bydmate-charging-session-samples", sessionId, vehicleId] as const,
  voltflowMateTripTrack: (tripId: string) => ["bydmate-trip-track", tripId] as const,
  voltflowMateTelemetryHistory: (range: string, date: string, vehicleId: string | null) =>
    ["bydmate-telemetry-history", range, date, vehicleId] as const,
  voltflowMateSohHistory: (date: string, vehicleId: string | null) =>
    ["bydmate-soh-history", date, vehicleId] as const,
  voltflowMateAuxVoltageHistory: (vehicleId: string, from: string, to: string) =>
    ["bydmate-aux-voltage-history", vehicleId, from, to] as const,
  vehicleCommands: (vehicleId: string | null) => ["vehicle-commands", vehicleId] as const,
  mateLatestRelease: ["mate-latest-release"] as const,
  pairedDevices: ["bydmate-paired-devices"] as const,
  tariffLocations: ["tariff-locations"] as const,
  userProviders: ["user-providers"] as const,
  serviceRecords: (carId: string) => ["service-records", carId] as const,
  serviceRecord: (id: string) => ["service-record", id] as const,
  serviceReminders: (carId: string) => ["service-reminders", carId] as const,
  userServiceCategories: () => ["user-service-categories"] as const,
  chargingEfficiencySuggestions: (carId: string) =>
    ["charging-efficiency-suggestions", carId] as const,
  voltflowMateRecentChargeSamples: (vehicleId: string | null) =>
    ["bydmate-recent-charge-samples", vehicleId] as const,
};
