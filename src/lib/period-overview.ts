export async function resolveCompletePeriodOverview<TTrip, TSession>({
  trips,
  sessions,
  estimatedNoChargeDayPricePerKwh,
}: {
  trips: Promise<TTrip[]>;
  sessions: Promise<TSession[]>;
  estimatedNoChargeDayPricePerKwh: Promise<number | null>;
}) {
  const [resolvedTrips, resolvedSessions, resolvedPrice] = await Promise.all([
    trips,
    sessions,
    estimatedNoChargeDayPricePerKwh,
  ]);

  return {
    trips: resolvedTrips,
    sessions: resolvedSessions,
    estimatedNoChargeDayPricePerKwh: resolvedPrice,
  };
}
