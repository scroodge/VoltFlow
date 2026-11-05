"use client";

import { useMemo } from "react";
import { getServiceMapHref } from "@/lib/telegram/service-map-link";

export function ServiceMapLink({ address }: { address: string }) {
  const href = useMemo(() => {
    const language = navigator.language;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return getServiceMapHref(address, language, timezone);
  }, [address]);

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center text-sm font-bold text-[var(--voltflow-cyan)] underline decoration-[var(--voltflow-cyan)]/50 underline-offset-4 transition hover:text-foreground"
    >
      Открыть на карте
    </a>
  );
}
