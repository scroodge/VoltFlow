export const carGenerations = ["gen1_2024", "gen2_2025"] as const;

export type CarGeneration = (typeof carGenerations)[number];

export function isCarGeneration(value: unknown): value is CarGeneration {
  return typeof value === "string" && carGenerations.includes(value as CarGeneration);
}

export type CarGenerationPreset = {
  battery_capacity_kwh: number;
  default_charger_power_kw: number;
  default_efficiency_percent: number;
};

export const carGenerationPresets: Record<CarGeneration, CarGenerationPreset> = {
  gen1_2024: {
    battery_capacity_kwh: 45.1,
    default_charger_power_kw: 7,
    default_efficiency_percent: 92,
  },
  gen2_2025: {
    battery_capacity_kwh: 45.1,
    default_charger_power_kw: 11,
    default_efficiency_percent: 92,
  },
};
