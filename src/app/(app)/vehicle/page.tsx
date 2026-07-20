import type { Metadata } from "next";
import { Suspense } from "react";

import { VehicleHub } from "@/components/vehicle/vehicle-hub";
import { isCurrentUserAdmin } from "@/lib/supabase/knowledge";

export const metadata: Metadata = {
  title: "Авто",
};

function VehicleLoading() {
  return (
    <div className="safe-bottom px-3 pt-3" role="status" aria-label="Loading vehicle">
      <div className="flex rounded-full border border-border bg-white/[0.03] p-1">
        <div className="h-9 flex-1 animate-pulse rounded-full bg-white/[0.06]" />
        <div className="h-9 flex-1 animate-pulse rounded-full bg-white/[0.03]" />
      </div>
      <div className="mt-3 space-y-3 px-1">
        <div className="h-32 animate-pulse rounded-[1.75rem] bg-white/[0.05]" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-28 animate-pulse rounded-[1.5rem] bg-white/[0.04]" />
          <div className="h-28 animate-pulse rounded-[1.5rem] bg-white/[0.04]" />
          <div className="h-28 animate-pulse rounded-[1.5rem] bg-white/[0.04]" />
          <div className="h-28 animate-pulse rounded-[1.5rem] bg-white/[0.04]" />
        </div>
      </div>
    </div>
  );
}

async function VehiclePageContent() {
  const isAdmin = await isCurrentUserAdmin();

  return <VehicleHub isAdmin={isAdmin} />;
}

export default function VehiclePage() {
  return (
    <Suspense fallback={<VehicleLoading />}>
      <VehiclePageContent />
    </Suspense>
  );
}
