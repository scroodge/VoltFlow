import type { MetadataRoute } from "next";

import { defaultLocale } from "@/lib/i18n";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VoltFlow — трекер зарядки электромобиля",
    short_name: "VoltFlow",
    description:
      "Трекер зарядки в реальном времени, телеметрия автомобиля и история сессий для вашего BYD.",
    // Must match <html lang> in the root layout; the UI renders in `ru` by default.
    lang: defaultLocale,
    display: "standalone",
    orientation: "portrait",
    scope: "/",
    // NOT /dashboard: that route is auth-gated, so an installed PWA cold-starts
    // into a 307 to /login. The landing page redirects signed-in users onward
    // via onAuthStateChange, so authenticated users lose nothing.
    start_url: "/?utm_source=pwa",
    background_color: "#12151C",
    theme_color: "#12151C",
    icons: [
      {
        src: "/voltflow-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
