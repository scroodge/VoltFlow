"use client";

import { useMemo } from "react";

const CIS_LANGUAGES = ["ru", "be", "kk", "uk", "uz", "hy", "az", "ky", "tg", "tk", "mo"];
const CIS_TIMEZONES = [
  "Europe/Minsk",
  "Europe/Moscow",
  "Europe/Kyiv",
  "Europe/Chisinau",
  "Asia/Almaty",
  "Asia/Aqtobe",
  "Asia/Tashkent",
  "Asia/Bishkek",
  "Asia/Dushanbe",
  "Asia/Yerevan",
  "Asia/Baku",
  "Asia/Ashgabat",
];

export function ServiceMapLink({ address }: { address: string }) {
  const href = useMemo(() => {
    const language = navigator.language.toLowerCase().split("-")[0];
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const isCis = CIS_LANGUAGES.includes(language) || CIS_TIMEZONES.includes(timezone);
    const encoded = encodeURIComponent(address);
    return isCis
      ? `https://yandex.com/maps/?text=${encoded}`
      : `https://www.google.com/maps/search/?api=1&query=${encoded}`;
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
