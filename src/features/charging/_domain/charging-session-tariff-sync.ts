import type { ChargingSessionRow } from "@/types/database";
import type { TariffResolution } from "@/lib/charging-tariffs";

export function sessionTariffMatches(
  session: Pick<ChargingSessionRow, "tariff_type" | "provider_type" | "user_provider_id" | "price_per_kwh">,
  tariff: Pick<TariffResolution, "tariffType" | "providerType" | "userProviderId" | "pricePerKwh">,
): boolean {
  return (
    session.tariff_type === tariff.tariffType &&
    session.provider_type === tariff.providerType &&
    session.user_provider_id === tariff.userProviderId &&
    Math.abs(session.price_per_kwh - tariff.pricePerKwh) < 0.0001
  );
}

export function shouldAutoApplyTariffResolution(resolution: TariffResolution): boolean {
  return resolution.source === "location";
}
