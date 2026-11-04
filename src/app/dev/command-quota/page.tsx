import { notFound } from "next/navigation";

import { CommandQuotaDevClient } from "./CommandQuotaDevClient";

export const dynamic = "force-dynamic";

/** Dev only: the free-plan quota notice and support dialog, without a free account. */
export default function CommandQuotaDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="safe-bottom px-4 pb-8 pt-5">
      <CommandQuotaDevClient />
    </main>
  );
}
