import type { Metadata } from "next";
import { Suspense } from "react";

import { VehicleDevToolbar } from "@/components/dev/vehicle-dev-toolbar";
import { VehicleLiveView } from "@/components/vehicle/vehicle-live-view";

export const metadata: Metadata = {
  title: "Авто",
};

export default function VehiclePage() {
  return (
    <>
      <VehicleDevToolbar />
      <Suspense fallback={null}>
        <VehicleLiveView />
      </Suspense>
    </>
  );
}
