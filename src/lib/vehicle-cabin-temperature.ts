export function readDiPlusCabinTemperature({
  modelGeneration,
  isParkedOrCharging,
  diplusInsideTempC,
}: {
  modelGeneration: "gen1_2024" | "gen2_2025" | null | undefined;
  isParkedOrCharging: boolean;
  diplusInsideTempC: unknown;
}) {
  if (modelGeneration !== "gen2_2025" || !isParkedOrCharging) return null;
  if (typeof diplusInsideTempC !== "number" || !Number.isFinite(diplusInsideTempC)) return null;
  if (diplusInsideTempC < -50 || diplusInsideTempC > 90) return null;
  return diplusInsideTempC;
}
