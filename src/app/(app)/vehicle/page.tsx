import type { Metadata } from "next";
import { Suspense } from "react";

import { VehicleDevToolbar } from "@/components/dev/vehicle-dev-toolbar";
import { VehicleLiveView } from "@/components/vehicle/vehicle-live-view";
import { isCurrentUserAdmin } from "@/lib/supabase/knowledge";

export const metadata: Metadata = {
  title: "Авто",
};

export default async function VehiclePage() {
  const isAdmin = await isCurrentUserAdmin();

  return (
    <>
      <VehicleDevToolbar />
      <Suspense fallback={null}>
        <VehicleLiveView isAdmin={isAdmin} />
      </Suspense>
    </>
  );
}
