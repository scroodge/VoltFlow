import type { Metadata } from "next";
import { Suspense } from "react";

import { VehicleHub } from "@/components/vehicle/vehicle-hub";
import { isCurrentUserAdmin } from "@/lib/supabase/knowledge";

export const metadata: Metadata = {
  title: "Авто",
};

export default async function VehiclePage() {
  const isAdmin = await isCurrentUserAdmin();

  return (
    <Suspense fallback={null}>
      <VehicleHub isAdmin={isAdmin} />
    </Suspense>
  );
}
