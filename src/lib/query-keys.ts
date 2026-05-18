export const queryKeys = {
  cars: ["cars"] as const,
  sessions: ["sessions"] as const,
  session: (id: string) => ["session", id] as const,
  profile: ["profile"] as const,
  bydmateLive: ["bydmate-live"] as const,
  bydmateTelemetryPoints: ["bydmate-telemetry-points"] as const,
};
