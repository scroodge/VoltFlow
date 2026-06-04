"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

function formatEnergyKwh(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "—";
}

export function BatteryRing({
  percent,
  status,
  detail,
  charging = false,
  size = "default",
  className,
  displayMode = "percent",
  energyKwh,
  toggleAriaLabel,
  onToggleDisplay,
}: {
  percent: number;
  status: string;
  detail?: string | null;
  charging?: boolean;
  size?: "default" | "compact";
  className?: string;
  displayMode?: "percent" | "energy";
  energyKwh?: number | null;
  toggleAriaLabel?: string;
  onToggleDisplay?: () => void;
}) {
  const value = Math.max(0, Math.min(100, percent));
  const radius = 92;
  const circumference = 2 * Math.PI * radius;
  const compact = size === "compact";
  const showEnergy = displayMode === "energy";
  const interactive = Boolean(onToggleDisplay);

  const centerContent = (
    <>
      {showEnergy ? (
        <p
          className={cn(
            "font-heading font-bold leading-none tracking-normal text-foreground tabular-nums",
            compact ? "text-3xl" : "text-5xl",
          )}
        >
          {formatEnergyKwh(energyKwh)}
          <span className={cn("text-muted-foreground", compact ? "text-sm" : "text-xl")}>
            {" "}
            kWh
          </span>
        </p>
      ) : (
        <p
          className={cn(
            "font-heading font-bold leading-none tracking-normal text-foreground tabular-nums",
            compact ? "text-4xl" : "text-6xl",
          )}
        >
          {Math.round(value)}
          <span className={cn("text-muted-foreground", compact ? "text-base" : "text-2xl")}>%</span>
        </p>
      )}
      <p
        className={cn(
          "font-semibold uppercase text-muted-foreground",
          compact ? "mt-1 text-[9px] tracking-[0.18em]" : "mt-2 text-xs tracking-[0.24em]",
        )}
      >
        {status}
      </p>
      {detail ? (
        <p
          className={cn(
            "font-heading font-semibold tracking-normal text-[var(--voltflow-cyan)] tabular-nums",
            compact ? "mt-1 text-sm" : "mt-2 text-lg",
          )}
        >
          {detail}
        </p>
      ) : null}
    </>
  );

  return (
    <div
      className={cn(
        "relative mx-auto grid aspect-square w-full place-items-center",
        compact ? "max-w-[132px]" : "max-w-[280px]",
        className,
      )}
    >
      <svg viewBox="0 0 240 240" className="absolute inset-0 size-full -rotate-90">
        <circle
          cx="120"
          cy="120"
          r={radius}
          stroke="#273040"
          strokeWidth="16"
          fill="none"
        />
        <motion.circle
          cx="120"
          cy="120"
          r={radius}
          stroke="url(#battery-ring-gradient)"
          strokeWidth={compact ? "18" : "16"}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          initial={false}
          animate={{
            strokeDashoffset: circumference - (value / 100) * circumference,
          }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{
            filter: charging
              ? "drop-shadow(0 0 18px rgba(0, 230, 118, 0.5))"
              : undefined,
          }}
        />
        <defs>
          <linearGradient
            id="battery-ring-gradient"
            x1="28"
            x2="212"
            y1="28"
            y2="212"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#00E676" />
            <stop offset="1" stopColor="#00D1FF" />
          </linearGradient>
        </defs>
      </svg>
      <div
        className={cn(
          "absolute inset-[22%] rounded-full border border-white/10 bg-[#12151C]/80 blur-2xl",
          charging && "shadow-[0_0_52px_rgba(0,209,255,0.25)]",
        )}
      />
      {interactive ? (
        <button
          type="button"
          className={cn(
            "relative z-10 rounded-full text-center outline-none transition",
            "focus-visible:ring-2 focus-visible:ring-[var(--voltflow-cyan)]/60",
            "active:scale-[0.98]",
          )}
          aria-label={toggleAriaLabel}
          aria-pressed={showEnergy}
          onClick={onToggleDisplay}
        >
          {centerContent}
        </button>
      ) : (
        <div className="relative text-center">{centerContent}</div>
      )}
    </div>
  );
}
