import { isCarGeneration } from "@/lib/car-generations";
import {
  DEFAULT_AC_EFFICIENCY_PERCENT,
  DEFAULT_FAST_DC_EFFICIENCY_PERCENT,
} from "@/lib/charging-efficiency";
import type {
  ChargingSessionRow,
  Car,
  ChargingProviderType,
  ChargingTariffType,
  ChargingTariffLocationRow,
  Profile,
  UserProviderRow,
} from "@/types/database";

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** For columns where "not measured" must stay distinct from 0. */
function nullableNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
) {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function mapCar(raw: Record<string, unknown>): Car {
  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    name: String(raw.name),
    model_generation: isCarGeneration(raw.model_generation)
      ? raw.model_generation
      : "gen1_2024",
    battery_capacity_kwh: num(raw.battery_capacity_kwh),
    default_charger_power_kw: num(raw.default_charger_power_kw, 4.4),
    default_efficiency_percent: num(raw.default_efficiency_percent, DEFAULT_AC_EFFICIENCY_PERCENT),
    fast_dc_efficiency_percent: num(
      raw.fast_dc_efficiency_percent,
      DEFAULT_FAST_DC_EFFICIENCY_PERCENT,
    ),
    home_charger_lat: raw.home_charger_lat != null ? num(raw.home_charger_lat) : null,
    home_charger_lon: raw.home_charger_lon != null ? num(raw.home_charger_lon) : null,
    home_charger_radius_m: raw.home_charger_radius_m != null ? num(raw.home_charger_radius_m, 150) : null,
    vehicle_alias: raw.vehicle_alias != null ? String(raw.vehicle_alias) : null,
    created_at: String(raw.created_at ?? ""),
  };
}

export function mapProfile(raw: Record<string, unknown>): Profile {
  const defaultPricePerKwh = num(raw.default_price_per_kwh, 0.12);
  return {
    id: String(raw.id),
    email: raw.email != null ? String(raw.email) : null,
    preferred_currency: enumValue(
      raw.preferred_currency,
      ["EUR", "USD", "BYN", "RUB"],
      "EUR",
    ),
    preferred_locale: enumValue(raw.preferred_locale, ["en", "be", "ru"], "en"),
    default_price_per_kwh: defaultPricePerKwh,
    home_price_per_kwh: num(raw.home_price_per_kwh, defaultPricePerKwh),
    commercial_ac_price_per_kwh: num(raw.commercial_ac_price_per_kwh, defaultPricePerKwh),
    fast_dc_price_per_kwh: num(raw.fast_dc_price_per_kwh, defaultPricePerKwh),
    is_premium: raw.is_premium === true,
    created_at: String(raw.created_at ?? ""),
  };
}

export function mapChargingSession(
  raw: Record<string, unknown>,
): ChargingSessionRow {
  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    car_id: String(raw.car_id),
    start_percent: num(raw.start_percent),
    current_percent: num(raw.current_percent),
    target_percent: num(raw.target_percent),
    battery_capacity_kwh: num(raw.battery_capacity_kwh),
    charger_power_kw: num(raw.charger_power_kw),
    efficiency_percent: num(raw.efficiency_percent),
    tariff_type: enumValue(
      raw.tariff_type,
      ["home", "commercial_ac", "fast_dc"] as const,
      "home",
    ) as ChargingTariffType,
    provider_type: enumValue(
      raw.provider_type,
      ["home", "malanka", "evika", "forevo", "zaryadka", "batterfly", "user_provider", "custom"] as const,
      "custom",
    ) as ChargingProviderType,
    user_provider_id: raw.user_provider_id ? String(raw.user_provider_id) : null,
    tariff_manual: raw.tariff_manual === true,
    tariff_selected_at: raw.tariff_selected_at ? String(raw.tariff_selected_at) : null,
    price_per_kwh: num(raw.price_per_kwh),
    energy_overridden: raw.energy_overridden === true,
    energy_corrected_at: raw.energy_corrected_at ? String(raw.energy_corrected_at) : null,
    charged_energy_kwh: num(raw.charged_energy_kwh),
    estimated_cost: num(raw.estimated_cost),
    status: raw.status as ChargingSessionRow["status"],
    started_at: raw.started_at ? String(raw.started_at) : null,
    stopped_at: raw.stopped_at ? String(raw.stopped_at) : null,
    end_max_cell_delta_v: nullableNum(raw.end_max_cell_delta_v),
    end_delta_soc: nullableNum(raw.end_delta_soc),
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
  };
}

export function mapChargingTariffLocation(
  raw: Record<string, unknown>,
): ChargingTariffLocationRow {
  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    name: String(raw.name ?? ""),
    lat: num(raw.lat),
    lng: num(raw.lng),
    radius_m: num(raw.radius_m, 150),
    tariff_type: enumValue(
      raw.tariff_type,
      ["home", "commercial_ac", "fast_dc"] as const,
      "home",
    ) as ChargingTariffType,
    provider_type: enumValue(
      raw.provider_type,
      ["home", "malanka", "evika", "forevo", "zaryadka", "batterfly", "user_provider", "custom"] as const,
      "custom",
    ) as ChargingProviderType,
    user_provider_id: raw.user_provider_id ? String(raw.user_provider_id) : null,
    price_per_kwh_override:
      raw.price_per_kwh_override != null ? num(raw.price_per_kwh_override) : null,
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
  };
}

export function mapUserProvider(raw: Record<string, unknown>): UserProviderRow {
  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    label: String(raw.label ?? ""),
    home_price_per_kwh: num(raw.home_price_per_kwh),
    commercial_ac_price_per_kwh: num(raw.commercial_ac_price_per_kwh),
    fast_dc_price_per_kwh: num(raw.fast_dc_price_per_kwh),
    is_default: raw.is_default === true,
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
  };
}
