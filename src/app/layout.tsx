import type { Metadata, Viewport } from "next";
import { Geist_Mono, Space_Grotesk } from "next/font/google";

import "./globals.css";

import { Providers } from "@/components/providers";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#12151C",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "VoltFlow",
    template: "%s · VoltFlow",
  },
  description: "Real-time EV charging tracker and calculator",
  applicationName: "VoltFlow",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "VoltFlow",
  },
  icons: {
    icon: [
      { url: "/voltflow-icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
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
    <html
      lang="en"
      suppressHydrationWarning
      className={`dark ${spaceGrotesk.variable} ${geistMono.variable}`}
    >
      <body className="bg-background font-sans min-h-dvh text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
