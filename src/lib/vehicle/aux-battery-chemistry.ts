import type { CarGeneration } from "@/lib/car-generations";

export const auxBatteryChemistries = ["flooded", "agm", "efb", "lifepo4", "other"] as const;
export type AuxBatteryChemistry = (typeof auxBatteryChemistries)[number];

export type AuxBatteryReference = {
  restingBand: readonly [number, number] | null;
  restingCeiling: number | null;
  lowVoltage: number;
};

export const AUX_BATTERY_REFERENCES: Record<AuxBatteryChemistry, AuxBatteryReference> = {
  flooded: { restingBand: [12.6, 12.7], restingCeiling: 12.9, lowVoltage: 11.8 },
  agm: { restingBand: [12.8, 12.9], restingCeiling: 13.1, lowVoltage: 12.0 },
  efb: { restingBand: [12.7, 12.8], restingCeiling: 13.0, lowVoltage: 11.9 },
  lifepo4: { restingBand: [13.3, 13.4], restingCeiling: 13.5, lowVoltage: 12.8 },
  // Unknown batteries retain self-baselining only and the legacy low reference.
  other: { restingBand: null, restingCeiling: null, lowVoltage: 11.8 },
};

export function isAuxBatteryChemistry(value: unknown): value is AuxBatteryChemistry {
  return typeof value === "string" && auxBatteryChemistries.includes(value as AuxBatteryChemistry);
}

export function deriveAuxBatteryChemistry(modelGeneration: CarGeneration): AuxBatteryChemistry {
  return modelGeneration === "gen2_2025" ? "lifepo4" : "flooded";
}

export function resolveAuxBatteryChemistry(
  chemistry: AuxBatteryChemistry | null | undefined,
  modelGeneration: CarGeneration | null | undefined,
): AuxBatteryChemistry {
  if (chemistry) return chemistry;
  return modelGeneration ? deriveAuxBatteryChemistry(modelGeneration) : "other";
}

export function auxLowVoltage(chemistry: AuxBatteryChemistry) {
  return AUX_BATTERY_REFERENCES[chemistry].lowVoltage;
}
