import type { Metadata, Viewport } from "next";
import "@fontsource/space-grotesk/300.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "./globals.css";
import { Providers } from "@/components/providers";
import { defaultLocale } from "@/lib/i18n";
import { siteOrigin } from "@/lib/site-url";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const viewport: Viewport = {
  themeColor: "#12151C",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const DESCRIPTION =
  "Трекер зарядки электромобиля в реальном времени: живые кВт·ч, стоимость сессии, " +
  "история зарядок и база знаний по BYD.";

export const metadata: Metadata = {
  // Without metadataBase every relative canonical and every opengraph-image
  // file-convention URL resolves against localhost:3000 at build time (or the
  // raw VERCEL_URL deploy host in prod), and Next warns about it on build.
  metadataBase: new URL(siteOrigin()),
  title: {
    default: "VoltFlow — трекер зарядки электромобиля",
    template: "%s · VoltFlow",
  },
  description: DESCRIPTION,
  // No `alternates` here on purpose. Metadata is inherited, so a root canonical
  // of "/" silently self-canonicalises every route that does not set its own —
  // /support, /onboarding, the whole (app) group and the KB detail routes all
  // pointed at the homepage, which tells Google they are duplicates of it.
  // Each indexable route declares its own canonical; non-indexable ones carry
  // `robots: noindex` instead.
  openGraph: {
    type: "website",
    siteName: "VoltFlow",
    // Server-rendered content is Russian throughout; see the <html lang> note below.
    locale: "ru_RU",
    url: siteOrigin(),
    title: "VoltFlow — трекер зарядки электромобиля",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "VoltFlow — трекер зарядки электромобиля",
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  applicationName: "VoltFlow",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "VoltFlow",
  },
  icons: {
    icon: [
      { url: "/voltflow-icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `useTranslation` falls back to `defaultLocale` on the server, so every
    // server-rendered page ships Russian text. It was hardcoded to "en", which
    // contradicted the body content for crawlers. Do NOT read the stored locale
    // here — it lives in localStorage, is unavailable server-side, and
    // suppressHydrationWarning would hide the mismatch rather than fix the
    // crawled HTML. `Providers` updates document.documentElement.lang on switch.
    <html
      lang={defaultLocale}
      suppressHydrationWarning
      className="dark"
    >
      <body className="bg-background font-sans min-h-dvh text-foreground antialiased">
        <Providers>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
