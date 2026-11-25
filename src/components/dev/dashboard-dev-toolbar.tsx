"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  useDashboardDevSnapshot,
  type DashboardDevSnapshotMode,
} from "@/components/dev/dashboard-dev-snapshot-context";
import { getDevPathPrefix } from "@/lib/dev/dev-path";

const MODES: { id: DashboardDevSnapshotMode; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "park", label: "Park" },
  { id: "charge", label: "Charge" },
  { id: "stale", label: "Stale" },
  { id: "nodata", label: "No Data" },
];

const SIMULATOR_MODES = [
  { id: "charge-ac", label: "Зарядка AC" },
  { id: "charge-dc", label: "Зарядка DC" },
  { id: "charge", label: "Зарядка без сессии" },
  { id: "charge-no-price", label: "Тариф не задан" },
  { id: "charge-free", label: "Бесплатная зарядка" },
  { id: "live", label: "Едет" },
  { id: "park", label: "Припарковано" },
  { id: "stale", label: "Данные устарели" },
  { id: "nodata", label: "Нет данных" },
] as const satisfies ReadonlyArray<{ id: DashboardDevSnapshotMode; label: string }>;

export function DashboardDevToolbar({
  simulation,
}: {
  simulation?: {
    failNextSave: boolean;
    setFailNextSave: (value: boolean) => void;
    onReset: () => void;
  };
}) {
  const pathname = usePathname();
  const ctx = useDashboardDevSnapshot();
  if (getDevPathPrefix(pathname) === "" || !ctx) return null;

  const { mode, setMode } = ctx;

  if (simulation) {
    return (
      <div className="sticky top-0 z-20 grid shrink-0 gap-2 border-b border-border bg-background px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <label htmlFor="dashboard-dev-scenario" className="shrink-0 font-semibold">Сценарий</label>
          <select
            id="dashboard-dev-scenario"
            value={mode}
            onChange={(event) => setMode(event.target.value as DashboardDevSnapshotMode)}
            className="min-w-0 flex-1 rounded-md border border-border bg-card p-2"
          >
            {SIMULATOR_MODES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <button type="button" onClick={simulation.onReset} className="p-2 font-semibold">Сбросить</button>
        </div>
        {mode.startsWith("charge-") ? (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={simulation.failNextSave}
              onChange={(event) => simulation.setFailNextSave(event.target.checked)}
            />
            Ошибка при следующем сохранении
          </label>
        ) : null}
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-background/95 px-3 py-2 backdrop-blur">
      <div className="inline-flex rounded-full border border-border bg-white/[0.03] p-0.5">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setMode(item.id)}
            className={
              "rounded-full px-2.5 py-1.5 font-heading text-[10px] font-semibold uppercase tracking-[0.14em] transition " +
              (mode === item.id
                ? item.id === "charge"
                  ? "bg-cyan-300/15 text-cyan-100"
                  : item.id === "park"
                    ? "bg-emerald-300/15 text-emerald-100"
                  : item.id === "stale"
                    ? "bg-amber-300/15 text-amber-100"
                  : item.id === "nodata"
                    ? "bg-rose-300/15 text-rose-100"
                  : "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground")
            }
            aria-pressed={mode === item.id}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-amber-200">
          Dev only
        </span>
        <Link href="/dev" className="transition hover:text-foreground">
          Index
        </Link>
      </div>
    </div>
  );
}
