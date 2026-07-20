import type { Metadata } from "next";
import { Suspense } from "react";

import { VehicleHub } from "@/components/vehicle/vehicle-hub";
import { isCurrentUserAdmin } from "@/lib/supabase/knowledge";

export const metadata: Metadata = {
  title: "Авто",
};

async function VehiclePageContent() {
  const isAdmin = await isCurrentUserAdmin();

  return <VehicleHub isAdmin={isAdmin} />;
}

export default function VehiclePage() {
  return (
    <Suspense fallback={<VehicleHub isAdmin={false} />}>
      <VehiclePageContent />
    </Suspense>
  );
}
