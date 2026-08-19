import type { Metadata } from "next";

/**
 * Defence in depth. `src/proxy.ts` already redirects anonymous requests to
 * /admin/* at the edge and robots.txt disallows the prefix, but neither
 * deindexes a URL that leaks into someone's link graph. Only one admin route
 * carried this directive before (the article preview page); this covers the
 * whole segment.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
