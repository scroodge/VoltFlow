import { normalizeDecimalInput } from "../../../lib/number-input.ts";

export type QuickSessionField = "startPct" | "targetPct" | "chargerKw" | "price";
export type QuickSessionFieldErrors = Partial<Record<QuickSessionField, true>>;

export type QuickSessionInput = {
  startPct: string;
  targetPct: string;
  chargerKw: string;
  price: string;
};

export type ValidQuickSessionInput = {
  startPercent: number;
  targetPercent: number;
  chargerPowerKw?: number;
  pricePerKwh: number;
};

function parseRequiredDecimal(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(normalizeDecimalInput(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Validates the values used to start a live charging session before calling the
 * Server Action. An intentionally entered zero price is valid and distinct from
 * a blank or non-numeric price, which must not silently select an auto tariff.
 */
export function validateQuickSessionInput(
  input: QuickSessionInput,
): { ok: true; value: ValidQuickSessionInput } | { ok: false; errors: QuickSessionFieldErrors } {
  const errors: QuickSessionFieldErrors = {};
  const startPercent = parseRequiredDecimal(input.startPct);
  const targetPercent = parseRequiredDecimal(input.targetPct);
  const pricePerKwh = parseRequiredDecimal(input.price);
  const chargerPowerKw =
    input.chargerKw.trim() === "" ? undefined : parseRequiredDecimal(input.chargerKw);

  if (startPercent === null || startPercent < 0 || startPercent > 99) {
    errors.startPct = true;
  }
  if (targetPercent === null || targetPercent < 1 || targetPercent > 100) {
    errors.targetPct = true;
  }
  if (
    startPercent !== null &&
    targetPercent !== null &&
    startPercent >= targetPercent
  ) {
    errors.targetPct = true;
  }
  if (pricePerKwh === null || pricePerKwh < 0 || pricePerKwh > 999) {
    errors.price = true;
  }
  if (chargerPowerKw === null || (chargerPowerKw !== undefined && (chargerPowerKw <= 0 || chargerPowerKw > 350))) {
    errors.chargerKw = true;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      startPercent: startPercent!,
      targetPercent: targetPercent!,
      pricePerKwh: pricePerKwh!,
      ...(chargerPowerKw === undefined ? {} : { chargerPowerKw: chargerPowerKw! }),
    },
  };
}
