"use client";

import { carGenerations, type CarGeneration } from "@/lib/car-generations";
import { cn } from "@/lib/utils";
import { telegramGenerationLabels } from "@/lib/telegram/generation";

type GenerationFilterProps = {
  value: CarGeneration;
  onChange: (generation: CarGeneration) => void;
};

export function GenerationFilter({ value, onChange }: GenerationFilterProps) {
  return (
    <div
      className="grid grid-cols-2 gap-1"
      role="group"
      aria-label="Поколение BYD Yuan Up"
    >
      {carGenerations.map((generation) => (
        <button
          key={generation}
          type="button"
          onClick={() => onChange(generation)}
          className={cn(
            "min-h-7 min-w-0 truncate rounded-md border px-2 text-[11px] font-semibold transition",
            value === generation
              ? "border-[var(--voltflow-green)] bg-[var(--voltflow-green)] text-[#06110B]"
              : "border-border bg-white/[0.03] text-muted-foreground",
          )}
        >
          {telegramGenerationLabels[generation]}
        </button>
      ))}
    </div>
  );
}
