import type { ChargingSessionRow } from "@/types/database";
import type { TariffResolution } from "@/lib/charging-tariffs";

export function sessionTariffMatches(
  session: Pick<ChargingSessionRow, "tariff_type" | "provider_type" | "price_per_kwh">,
  tariff: Pick<TariffResolution, "tariffType" | "providerType" | "pricePerKwh">,
): boolean {
  return (
    session.tariff_type === tariff.tariffType &&
    session.provider_type === tariff.providerType &&
    Math.abs(session.price_per_kwh - tariff.pricePerKwh) < 0.0001
  );
}

export function shouldAutoApplyTariffResolution(resolution: TariffResolution): boolean {
  return resolution.source === "location";
}
