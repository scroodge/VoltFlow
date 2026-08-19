import type { Metadata } from "next";

/**
 * `/auth/confirm` and `/auth/callback/recovery` are publicly reachable (they
 * have to be — they complete email links before a session exists) and are
 * client components, so they cannot export metadata themselves. They are
 * single-use token landing pages and must never appear in an index.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthCallbackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
