import type { ChargingTariffType } from "@/types/database";

/**
 * Charging losses differ by charge type, so efficiency is picked per tariff rather than
 * being one value per car.
 *
 * AC (home / commercial): measured ~98% on car `way` — 2.706 kWh from SOC × capacity
 * against 2.760 kWh grid truth. BYD calibrates the SOC display against AC charger input,
 * so SOC × capacity already lands close to grid-side energy.
 *
 * Fast DC: measured ~91% on car `way` — 16.7 kWh absorbed against 18.40 kWh metered by
 * the provider (2026-07-13). A DC dispenser meters upstream of the cable, its own cooling,
 * and the high-C-rate heat the pack sheds, so the gap is far larger than on AC.
 *
 * Both figures are per-car and user-editable — never hardcode them into the math.
 */
export const DEFAULT_AC_EFFICIENCY_PERCENT = 98;
export const DEFAULT_FAST_DC_EFFICIENCY_PERCENT = 90;

type EfficiencySource = {
  /** AC efficiency — home and commercial AC. */
  default_efficiency_percent: number;
  /** Fast-DC efficiency. */
  fast_dc_efficiency_percent?: number | null;
};

export function efficiencyPercentForTariff(
  car: EfficiencySource,
  tariffType: ChargingTariffType | null | undefined,
): number {
  if (tariffType === "fast_dc") {
    const dc = car.fast_dc_efficiency_percent;
    return typeof dc === "number" && Number.isFinite(dc) && dc > 0
      ? dc
      : DEFAULT_FAST_DC_EFFICIENCY_PERCENT;
  }
  return car.default_efficiency_percent;
}
