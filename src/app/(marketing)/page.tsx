import type { Metadata } from "next";

import { JsonLd, organizationSchema, websiteSchema } from "@/lib/seo/json-ld";
import { openGraph } from "@/lib/seo/open-graph";

import { LandingPage } from "./landing-page";

/**
 * Server wrapper that exists purely to carry metadata.
 *
 * `./landing-page.tsx` is `"use client"`, and a client component cannot export
 * `metadata` — which is why `/` shipped with the bare default title "VoltFlow"
 * and no description, canonical or OG tags.
 *
 * A page-level split is used rather than a `(marketing)/layout.tsx` because a
 * route-group layout's metadata would also apply to `/legal/*`, which has its
 * own `generateMetadata` and would then need overriding. This leaves the client
 * tree byte-identical.
 */
export const metadata: Metadata = {
  title: "Трекер зарядки электромобиля BYD",
  description:
    "Считайте зарядку BYD в реальном времени: живые кВт·ч, стоимость сессии, время до " +
    "полной и история зарядок. Работает как PWA на телефоне, без установки из магазина.",
  alternates: { canonical: "/" },
  openGraph: openGraph({
    type: "website",
    url: "/",
    title: "VoltFlow — трекер зарядки электромобиля BYD",
    description:
      "Живые кВт·ч, стоимость сессии и история зарядок для вашего BYD. PWA, без магазина приложений.",
  }),
};

export default function Page() {
  return (
    <>
      <JsonLd data={organizationSchema()} />
      <JsonLd data={websiteSchema()} />
      <LandingPage />
    </>
  );
}
