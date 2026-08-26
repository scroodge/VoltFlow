import type { Metadata } from "next";

import { MobileShell } from "@/components/layout/MobileShell";

/**
 * Defence in depth, matching src/app/admin/layout.tsx. robots.txt disallows
 * these prefixes and src/proxy.ts redirects anonymous requests to /login, but
 * Disallow only stops crawling — it does not deindex a URL that leaks into
 * someone's link graph, and a disallowed URL can still be indexed URL-only.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AppSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MobileShell>{children}</MobileShell>;
}
