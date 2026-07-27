"use client";

import { Zap } from "lucide-react";

import { cn } from "@/lib/utils";

export function ChargingActionButton({
  status,
  disabled,
  loading,
  labels,
  onClick,
}: {
  status: "charging" | "idle" | "completed" | "driving";
  disabled?: boolean;
  loading?: boolean;
  labels?: {
    start: string;
    stop: string;
    syncing: string;
    driving?: string;
  };
  onClick?: () => void;
}) {
  const isCharging = status === "charging";
  const isDriving = status === "driving";
  const text = loading
    ? (labels?.syncing ?? "Syncing")
    : isCharging
      ? (labels?.stop ?? "Stop charging")
      : isDriving
        ? (labels?.driving ?? labels?.start ?? "Start charging")
        : (labels?.start ?? "Start charging");

  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-full px-6 font-heading text-base font-bold uppercase tracking-[0.08em] transition-all active:scale-[0.99] disabled:pointer-events-none disabled:opacity-55",
        isCharging
          ? "border border-[#ff4d6d]/40 bg-[#ff4d6d]/12 text-[#ff8aa0] shadow-[0_0_24px_rgba(255,77,109,0.18)]"
          : isDriving
            ? "border border-[var(--voltflow-cyan)]/40 bg-[var(--voltflow-cyan)]/10 text-[var(--voltflow-cyan)] shadow-[0_0_24px_rgba(0,209,255,0.15)] hover:brightness-110"
            : "voltflow-glow bg-[linear-gradient(90deg,#00E676_0%,#00D1FF_100%)] text-[#06110B] hover:brightness-110",
      )}
    >
      <Zap className="size-5" aria-hidden />
      {text}
    </button>
  );
}
