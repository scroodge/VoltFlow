import type { Metadata } from "next";

/**
 * The /dev/* routes are a local development index and are rewritten away in
 * production by src/proxy.ts. robots.txt disallows the prefix, but Disallow
 * only stops crawling — it does not deindex. Matches src/app/admin/layout.tsx.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return children;
}
