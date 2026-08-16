import "server-only";

import { cookies, headers } from "next/headers";

import type { DashboardBootstrapData } from "@/components/dashboard/dashboard-bootstrap-types";
import {
  dashboardPreferencesCookieName,
  parseDashboardBrowserPreferences,
} from "@/lib/dashboard-preferences";
import { mapCar, mapChargingSession } from "@/lib/db-map";
import { defaultLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { VoltflowMateLiveSnapshotRow } from "@/types/database";

const SESSION_COLUMNS =
  "id,user_id,car_id,start_percent,current_percent,target_percent,battery_capacity_kwh,charger_power_kw,efficiency_percent,tariff_type,provider_type,user_provider_id,tariff_manual,tariff_selected_at,price_per_kwh,energy_overridden,energy_corrected_at,manual_entry,charged_energy_kwh,estimated_cost,status,started_at,stopped_at,end_max_cell_delta_v,end_delta_soc,created_at,updated_at" as const;

/**
 * Reads only existing RLS-scoped dashboard facts. This starts the three independent
 * queries together and deliberately does not call the application's own API routes.
 */
export async function loadDashboardBootstrap(): Promise<DashboardBootstrapData | null> {
  const requestHeaders = await headers();
  // Development fixture routes intentionally have no real Supabase session. Keep their
  // browser-side mock contract intact instead of server-rendering an empty real-data state.
  if (requestHeaders.get("x-voltflow-dev-auth-bypass") === "1") return null;

  const [cookieStore, supabase] = await Promise.all([cookies(), createClient()]);
  const preferences = parseDashboardBrowserPreferences(
    cookieStore.get(dashboardPreferencesCookieName)?.value,
  );

  const [carsResult, liveResult, sessionsResult] = await Promise.all([
    supabase.from("cars").select("*").order("created_at", { ascending: false }),
    supabase
      .from("bydmate_live_snapshots")
      .select("*")
      .order("received_at", { ascending: false }),
    supabase
      .from("charging_sessions")
      .select(SESSION_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (carsResult.error) throw carsResult.error;
  if (liveResult.error) throw liveResult.error;
  if (sessionsResult.error) throw sessionsResult.error;

  const cars = (carsResult.data ?? []).map((row) => mapCar(row as Record<string, unknown>));
  const selectedCarId =
    preferences?.selectedCarId && cars.some((car) => car.id === preferences.selectedCarId)
      ? preferences.selectedCarId
      : cars.length === 1
        ? cars[0].id
        : null;

  return {
    cars,
    liveSnapshots: (liveResult.data ?? []) as VoltflowMateLiveSnapshotRow[],
    sessions: (sessionsResult.data ?? []).map((row) =>
      mapChargingSession(row as Record<string, unknown>),
    ),
    selectedCarId,
    locale: preferences?.locale ?? defaultLocale,
  };
}
