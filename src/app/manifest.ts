import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VoltFlow",
    short_name: "VoltFlow",
    description: "Real-time EV charging tracker and calculator",
    lang: "en",
    display: "standalone",
    orientation: "portrait",
    scope: "/",
    start_url: "/dashboard",
    background_color: "#12151C",
    theme_color: "#12151C",
    icons: [
      {
        src: "/voltflow-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
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
        purpose: "maskable",
      },
    ],
  };
}
