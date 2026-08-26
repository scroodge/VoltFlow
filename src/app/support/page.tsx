import type { Metadata } from "next";

import { openGraph } from "@/lib/seo/open-graph";

import { SupportPage } from "./support-page";

/**
 * Server wrapper that exists purely to carry metadata, mirroring the
 * `(marketing)/page.tsx` + `landing-page.tsx` split.
 *
 * `./support-page.tsx` is `"use client"` and a client component cannot export
 * `metadata`, so this route inherited the root title and description verbatim —
 * and, until the root `alternates` was removed, a canonical pointing at `/`.
 * It is listed in sitemap.ts, so Google would have folded it into the homepage
 * as a duplicate.
 */
const DESCRIPTION =
  "Поддержать разработку VoltFlow — трекера зарядки электромобиля: способы помочь " +
  "проекту и связаться с автором.";

export const metadata: Metadata = {
  title: "Поддержать проект",
  description: DESCRIPTION,
  alternates: { canonical: "/support" },
  openGraph: openGraph({
    type: "website",
    url: "/support",
    title: "Поддержать VoltFlow",
    description: DESCRIPTION,
  }),
};

export default function Page() {
  return <SupportPage />;
}
