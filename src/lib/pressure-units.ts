export const pressureUnits = ["kPa", "psi", "bar"] as const;

export type PressureUnit = (typeof pressureUnits)[number];

export const defaultPressureUnit: PressureUnit = "kPa";

const PSI_PER_KPA = 0.1450377377;

export function isPressureUnit(value: unknown): value is PressureUnit {
  return typeof value === "string" && pressureUnits.includes(value as PressureUnit);
}

export function isTyrePressureKpa(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 100;
}

export function convertPressureFromKpa(kpa: number, unit: PressureUnit): number {
  switch (unit) {
    case "psi":
      return kpa * PSI_PER_KPA;
    case "bar":
      return kpa / 100;
    case "kPa":
      return kpa;
  }
}

export function formatPressureFromKpa(kpa: number, unit: PressureUnit): string {
  const digits = unit === "kPa" ? 0 : unit === "psi" ? 1 : 2;
  return convertPressureFromKpa(kpa, unit).toFixed(digits);
}
