"use client";

import { VehicleComfortControls } from "@/components/vehicle/vehicle-comfort-controls";

export type VehicleControlPanelProps = {
  enabled: boolean;
  vehicleId: string | null;
  /** Dev only: allow enqueue without fresh parked live snapshot. */
  relaxGuards?: boolean;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  /** Raw command history (type, status, error) under the buttons: admins / dev only. */
  showHistory?: boolean;
};

/** Remote comfort controls (windows + climate). Used on vehicle page and /dev/vehicle-control. */
export function VehicleControlPanel({
  enabled,
  vehicleId,
  relaxGuards = false,
  collapsible = false,
  defaultExpanded = false,
  showHistory = false,
}: VehicleControlPanelProps) {
  if (!enabled) return null;

  return (
    <VehicleComfortControls
      vehicleId={vehicleId}
      relaxGuards={relaxGuards}
      collapsible={collapsible}
      defaultExpanded={defaultExpanded}
      showHistory={showHistory}
    />
  );
}
