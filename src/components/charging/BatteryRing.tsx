"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

export function BatteryRing({
  percent,
  status,
  charging = false,
  size = "default",
  className,
}: {
  percent: number;
  status: string;
  charging?: boolean;
  size?: "default" | "compact";
  className?: string;
}) {
  const value = Math.max(0, Math.min(100, percent));
  const radius = 92;
  const circumference = 2 * Math.PI * radius;
  const compact = size === "compact";

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
      <div className="relative text-center">
        <p
          className={cn(
            "font-heading font-bold leading-none tracking-normal text-foreground tabular-nums",
            compact ? "text-4xl" : "text-6xl",
          )}
        >
          {Math.round(value)}
          <span className={cn("text-muted-foreground", compact ? "text-base" : "text-2xl")}>%</span>
        </p>
        <p
          className={cn(
            "font-semibold uppercase text-muted-foreground",
            compact ? "mt-1 text-[9px] tracking-[0.18em]" : "mt-3 text-xs tracking-[0.24em]",
          )}
        >
          {status}
        </p>
      </div>
    </div>
  );
}
