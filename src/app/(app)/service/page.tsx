import type { Metadata } from "next";
import { Suspense } from "react";

import { ServiceView } from "@/components/service/service-view";

export const metadata: Metadata = {
  title: "Service",
};

export default function ServicePage() {
  return (
    <Suspense fallback={null}>
      <ServiceView />
    </Suspense>
  );
}
