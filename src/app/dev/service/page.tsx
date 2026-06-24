import { notFound } from "next/navigation";
import { Suspense } from "react";

import { MobileShell } from "@/components/layout/MobileShell";
import { ServiceView } from "@/components/service/service-view";

export const dynamic = "force-dynamic";

export default function DevServicePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <MobileShell>
      <Suspense fallback={null}>
        <ServiceView />
      </Suspense>
    </MobileShell>
  );
}
