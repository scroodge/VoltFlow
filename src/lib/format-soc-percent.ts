/**
 * SOC displays at one decimal (0.1%, matching Di+ resolution), except at 100% where a
 * trailing ".0" reads as false precision — the battery is simply full. Rounds first so a
 * value like 99.96 (which would display as "100.0") also collapses to "100".
 */
export function formatSocPercent(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(digits));
  return rounded >= 100 ? "100" : rounded.toFixed(digits);
}
