import type { Metadata } from "next";

/**
 * `page.tsx` here is a client component, so it cannot export metadata itself.
 * A layout is the cheapest way to attach the directive without splitting the
 * page into a server wrapper.
 *
 * Search-results pages are classic index bloat: unbounded, thin, and
 * near-duplicate. The KB search is also POST-only, so there is nothing
 * meaningful for a crawler to fetch here anyway.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function KnowledgeSearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
