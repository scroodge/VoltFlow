"use client";

import { CarFront, Wrench } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { ChargingDevToolbar } from "@/components/dev/charging-dev-toolbar";
import { VehicleDevToolbar } from "@/components/dev/vehicle-dev-toolbar";
import { ServiceView } from "@/components/service/service-view";
import { VehicleLiveView } from "@/components/vehicle/vehicle-live-view";
import { useTranslation } from "@/hooks/use-translation";
import { cn } from "@/lib/utils";

// Charge is no longer a tab — charging detail (params + SOC graph) is shown inline on the
// Live view when the car is charging. The full-control screen lives at /charging/[id]
// (deep-linked from charge-complete notifications); history lives at /history.
type VehicleTab = "live" | "service";

const tabDefs: Record<VehicleTab, { icon: typeof CarFront }> = {
  live: { icon: CarFront },
  service: { icon: Wrench },
};

export function VehicleHub({ isAdmin }: { isAdmin: boolean }) {
  const searchParams = useSearchParams();
  const { t } = useTranslation();

  const visibleTabs: VehicleTab[] = useMemo(() => ["live", "service"], []);

  const activeTab: VehicleTab = useMemo(() => {
    const tab = searchParams.get("tab");
    // Legacy ?tab=charge links (e.g. old bookmarks) fall through to Live.
    if (tab === "live" || tab === "service") return tab;
    return "live";
  }, [searchParams]);

  const setTab = useCallback(
    (tab: VehicleTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "live") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      const query = params.toString();
      const url = query ? `/vehicle?${query}` : "/vehicle";
      window.history.replaceState(null, "", url);
    },
    [searchParams],
  );

  return (
    <>
      <VehicleDevToolbar />
      <ChargingDevToolbar />

      <div className="px-3 pt-3">
        <div className="flex rounded-full border border-border bg-white/[0.03] p-1">
          {visibleTabs.map((id) => {
            const { icon: Icon } = tabDefs[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-sm font-semibold transition",
                  activeTab === id
                    ? "bg-[var(--voltflow-green)]/14 text-[var(--voltflow-green)] shadow-[0_0_12px_rgba(0,230,118,0.15)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={activeTab === id ? "page" : undefined}
              >
                <Icon className="size-4" aria-hidden />
                {t(id === "live" ? "vehicle.tab.live" : "vehicle.tab.service") || id.charAt(0).toUpperCase() + id.slice(1)}
              </button>
            );
          })}
        </div>

        <div className="mt-3">
          {activeTab === "live" ? <VehicleLiveView isAdmin={isAdmin} /> : null}
          {activeTab === "service" ? <ServiceView /> : null}
        </div>
      </div>
    </>
  );
}
