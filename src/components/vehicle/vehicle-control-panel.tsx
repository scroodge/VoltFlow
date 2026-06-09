"use client";

import { VehicleComfortControls } from "@/components/vehicle/vehicle-comfort-controls";

export type VehicleControlPanelProps = {
  vehicleId: string | null;
  /** Dev only: allow enqueue without fresh parked live snapshot. */
  relaxGuards?: boolean;
  collapsible?: boolean;
  defaultExpanded?: boolean;
};

/** Remote comfort controls (windows + climate). Used on vehicle page and /dev/vehicle-control. */
export function VehicleControlPanel({
  vehicleId,
  relaxGuards = false,
  collapsible = false,
  defaultExpanded = false,
}: VehicleControlPanelProps) {
  return (
    <VehicleComfortControls
      vehicleId={vehicleId}
      relaxGuards={relaxGuards}
      collapsible={collapsible}
      defaultExpanded={defaultExpanded}
    />
  );
}
