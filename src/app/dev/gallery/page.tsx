"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { BatteryRing } from "@/components/charging/BatteryRing";
import { useTranslation } from "@/hooks/use-translation";
import { formatTimeAgo } from "@/lib/time-ago";
import {
  dashboardStatusBadgeClass,
  dashboardVehicleStatusLabelKey,
  type DashboardVehicleMode,
} from "@/lib/vehicle-live-mode";

/**
 * Dev-only variant gallery: every visual state of the dashboard status card side by
 * side, so a layout change can be checked against all of them at once instead of
 * clicking the mode toolbar one variant at a time.
 *
 * Deliberately renders the *presentational* pieces (BatteryRing + the status header)
 * from hand-built props rather than mounting DashboardView, which is wired into
 * react-query, Supabase and the preferences store. That keeps this page instant and
 * network-free — the trade-off is that it exercises the components, not the data
 * plumbing. For the fully wired card use /dev/site/dashboard and its mode toolbar.
 */

const CAR_IMAGE = "/images/cars/yuan-up.png";

const NOW = Date.parse("2026-07-13T12:00:00.000Z");
const RECEIVED_FRESH = new Date(NOW - 12_000).toISOString();
const RECEIVED_STALE = new Date(NOW - 47 * 60_000).toISOString();

type CardVariant = {
  label: string;
  note: string;
  mode: DashboardVehicleMode;
  percent: number | null;
  receivedAt: string | null;
  carName: string;
  showImage: boolean;
  showRange: boolean;
  rightColumn: "stats" | "charging" | "driving" | "calculator";
};

const VARIANTS: CardVariant[] = [
  {
    label: "Charging (app session)",
    note: "The reported case — the image must not touch the car name.",
    mode: "app_charging",
    percent: 98,
    receivedAt: RECEIVED_FRESH,
    carName: "Yuan UP Way",
    showImage: true,
    showRange: true,
    rightColumn: "charging",
  },
  {
    label: "Charging (live telemetry)",
    note: "Auto-detected from the car, no app session open.",
    mode: "live_charging",
    percent: 61,
    receivedAt: RECEIVED_FRESH,
    carName: "Yuan UP Way",
    showImage: true,
    showRange: true,
    rightColumn: "charging",
  },
  {
    label: "Driving",
    note: "Tallest right column (4 stat tiles) — worst case for image drift.",
    mode: "driving",
    percent: 74,
    receivedAt: RECEIVED_FRESH,
    carName: "Yuan UP Way",
    showImage: true,
    showRange: false,
    rightColumn: "driving",
  },
  {
    label: "Parked",
    note: "Park calculator on the right, last-seen line under the badge.",
    mode: "parked",
    percent: 52,
    receivedAt: RECEIVED_FRESH,
    carName: "Yuan UP Way",
    showImage: true,
    showRange: true,
    rightColumn: "calculator",
  },
  {
    label: "Stale (no recent telemetry)",
    note: "Badge + last-seen line carry the state; the ring stays a bare number.",
    mode: "stale",
    percent: 44,
    receivedAt: RECEIVED_STALE,
    carName: "Yuan UP Way",
    showImage: true,
    showRange: false,
    rightColumn: "calculator",
  },
  {
    label: "No data at all",
    note: 'Ring shows "—", never a fabricated percent. Pack tile degrades too.',
    mode: "stale",
    percent: null,
    receivedAt: null,
    carName: "Yuan UP Way",
    showImage: true,
    showRange: false,
    rightColumn: "stats",
  },
  {
    label: "No car image",
    note: "Model with no artwork — the ring must not jump into the header.",
    mode: "parked",
    percent: 52,
    receivedAt: RECEIVED_FRESH,
    carName: "Unknown model",
    showImage: false,
    showRange: true,
    rightColumn: "calculator",
  },
  {
    label: "Long vehicle name",
    note: "The name must truncate, not wrap under the badge.",
    mode: "parked",
    percent: 52,
    receivedAt: RECEIVED_FRESH,
    carName: "My extremely long vehicle nickname for testing",
    showImage: true,
    showRange: true,
    rightColumn: "calculator",
  },
];

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-[#12151C]/70 px-2.5 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 font-heading text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

function RightColumn({ kind }: { kind: CardVariant["rightColumn"] }) {
  if (kind === "driving") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Avg speed" value="48 km/h" />
        <StatTile label="Consumption" value="14.2 kWh/100" />
        <StatTile label="Distance" value="23.7 km" />
        <StatTile label="Regen" value="1.84 kWh" />
      </div>
    );
  }

  if (kind === "charging") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Pack" value="44.2 / 45 kWh" />
        <StatTile label="Charger" value="4.0 kW" />
      </div>
    );
  }

  if (kind === "calculator") {
    return (
      <div className="grid gap-2">
        <div className="grid grid-cols-3 gap-1 rounded-full border border-border/70 bg-[#12151C]/70 p-0.5 text-center">
          {["Home", "AC", "DC"].map((item, index) => (
            <span
              key={item}
              className={
                "rounded-full px-2 py-1 font-heading text-[10px] font-bold uppercase " +
                (index === 0
                  ? "bg-[var(--voltflow-green)]/18 text-[var(--voltflow-green)]"
                  : "text-muted-foreground")
              }
            >
              {item}
            </span>
          ))}
        </div>
        <div className="rounded-2xl border border-border/70 bg-[#12151C]/55 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              Time to full
            </span>
            <span className="font-heading text-base font-bold tabular-nums">6h 12m</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              Cost to full
            </span>
            <span className="font-heading text-base font-bold tabular-nums">
              BYN 5.20
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      <StatTile label="Pack" value="— / 45 kWh" />
    </div>
  );
}

function StatusCard({ variant }: { variant: CardVariant }) {
  const { t } = useTranslation();
  const [ringDisplay, setRingDisplay] = useState<"percent" | "energy">("percent");

  const statusLabel = String(t(dashboardVehicleStatusLabelKey(variant.mode)));
  const charging = variant.mode === "app_charging" || variant.mode === "live_charging";
  const lastSeenLabel =
    (variant.mode === "parked" || variant.mode === "stale") && variant.receivedAt
      ? formatTimeAgo(variant.receivedAt, NOW, (key, values) => String(t(key, values)))
      : null;

  return (
    <section className="voltflow-card overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("dashboard.vehicle")}
          </p>
          <h1 className="mt-1 truncate font-heading text-xl font-bold tracking-normal">
            {variant.carName}
          </h1>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div
            className={`rounded-full border border-border bg-white/[0.04] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${dashboardStatusBadgeClass(variant.mode)}`}
          >
            {statusLabel}
          </div>
          {lastSeenLabel ? (
            <p className="text-right text-[10px] leading-4 text-muted-foreground">
              {t("dashboard.lastSeen", { value: lastSeenLabel })}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[116px_minmax(0,1fr)] items-stretch gap-3">
        <div>
          {variant.showImage ? (
            <div className="mb-1 flex h-12 w-[116px] items-center justify-center overflow-hidden">
              <Image
                src={CAR_IMAGE}
                alt=""
                aria-hidden="true"
                width={2000}
                height={780}
                sizes="132px"
                className="h-full w-full object-contain"
              />
            </div>
          ) : null}
          {/* Badge anchors to the ring, not the grid cell — the cell stretches to the
              tallest column and would drop the badge far below the circle. */}
          <div className="relative pb-9">
            <BatteryRing
              percent={variant.percent}
              charging={charging}
              size="compact"
              displayMode={ringDisplay}
              energyKwh={variant.percent == null ? null : (variant.percent * 45) / 100}
              toggleAriaLabel="Toggle ring display"
              onToggleDisplay={() =>
                setRingDisplay((mode) => (mode === "percent" ? "energy" : "percent"))
              }
            />
            {variant.showRange ? (
              <div className="absolute inset-x-0 bottom-0 z-10 mx-auto w-fit rounded-full border border-[var(--voltflow-cyan)]/35 bg-[#10151D]/95 px-3 py-1 font-heading text-sm font-bold text-[var(--voltflow-cyan)] shadow-[0_0_18px_rgba(0,209,255,0.18)] tabular-nums">
                ≈ 244 km
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-col justify-center gap-3 text-xs">
          <RightColumn kind={variant.rightColumn} />
        </div>
      </div>
    </section>
  );
}

const RING_STATES: {
  label: string;
  percent: number | null;
  status: string | null;
  charging: boolean;
}[] = [
  { label: "Charging", percent: 98, status: "Charging", charging: true },
  { label: "Parked", percent: 52, status: "Parking", charging: false },
  { label: "Stale (no status text)", percent: 44, status: null, charging: false },
  { label: "No data", percent: null, status: null, charging: false },
  { label: "Empty battery", percent: 0, status: "Parking", charging: false },
  { label: "Full battery", percent: 100, status: "Charging", charging: true },
];

export default function DevGalleryPage() {
  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground">
      <header className="mx-auto mb-6 flex max-w-[1400px] items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold">Component gallery</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every dashboard status-card variant at once, each in the PWA&rsquo;s real
            430px phone frame. Frozen clock, hand-built props, no network. For the fully
            wired card use{" "}
            <Link
              href="/dev/site/dashboard"
              className="text-[var(--voltflow-cyan)] underline"
            >
              /dev/site/dashboard
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em]">
          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-amber-200">
            Dev only
          </span>
          <Link href="/dev" className="text-muted-foreground hover:text-foreground">
            Index
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-[1400px]">
        <h2 className="mb-3 font-heading text-sm font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Status card · all modes
        </h2>
        <div className="flex flex-wrap gap-6">
          {VARIANTS.map((variant) => (
            <div key={variant.label} className="w-[430px] max-w-full space-y-2">
              <div>
                <p className="font-heading text-sm font-bold">{variant.label}</p>
                <p className="text-xs leading-5 text-muted-foreground">{variant.note}</p>
              </div>
              {/* Same 430px frame the PWA renders in (.mobile-page), so what you see
                  here is what a phone sees — not a stretched desktop column. */}
              <div className="rounded-[2rem] border border-border/60 bg-background p-3 shadow-[0_0_40px_rgba(0,0,0,0.35)]">
                <StatusCard variant={variant} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-10 max-w-[1400px]">
        <h2 className="mb-3 font-heading text-sm font-bold uppercase tracking-[0.18em] text-muted-foreground">
          BatteryRing · isolated states
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {RING_STATES.map((state) => (
            <div key={state.label} className="voltflow-card p-4 text-center">
              <BatteryRing
                percent={state.percent}
                status={state.status}
                charging={state.charging}
                size="compact"
              />
              <p className="mt-3 text-xs text-muted-foreground">{state.label}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          The dashboard card no longer passes <code>status</code> at all — the ring is a
          bare number there. The prop is kept (and shown here) because the charging
          screen and the landing page still label their rings.
        </p>
      </section>
    </main>
  );
}
