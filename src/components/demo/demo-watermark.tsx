import type { ReactNode } from "react";

/**
 * Wraps sample/demo content with a persistent "TEST" corner ribbon and a slight
 * opacity dip so it reads clearly as a preview, never as the user's real data.
 */
export function DemoWatermark({
  children,
  label = "TEST",
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div className={`relative opacity-90 ${className ?? ""}`}>
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-20 w-20 overflow-hidden rounded-tr-2xl">
        <span className="absolute right-[-34px] top-[16px] w-[120px] rotate-45 bg-amber-400 py-0.5 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-black shadow-sm">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}
