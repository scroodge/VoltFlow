"use client";

import { useTranslation } from "@/hooks/use-translation";

export function TariffLocationMapPreview({
  lat,
  lng,
}: {
  lat: number;
  lng: number;
}) {
  const { t } = useTranslation();
  const latDelta = 0.006;
  const lngDelta = 0.012;
  const params = new URLSearchParams({
    bbox: [lng - lngDelta, lat - latDelta, lng + lngDelta, lat + latDelta].join(
      ",",
    ),
    layer: "mapnik",
    marker: `${lat},${lng}`,
  });
  const osmUrl = `https://www.openstreetmap.org/export/embed.html?${params.toString()}`;
  const externalUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
      <iframe
        title={t("settings.tariffMapTitle") as string}
        src={osmUrl}
        className="h-64 w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
      <div className="border-t border-white/[0.08] px-3 py-2 text-xs">
        <a
          href={externalUrl}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground transition hover:text-foreground"
        >
          {t("settings.openInOsm")}
        </a>
      </div>
    </div>
  );
}
