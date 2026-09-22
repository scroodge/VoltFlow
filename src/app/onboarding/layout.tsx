import type { Metadata } from "next";

export const metadata: Metadata = {
  // `page.tsx` is a Client Component, so this server wrapper owns its route
  // metadata. robots.txt alone cannot prevent URL-only indexing after an
  // external link reaches this authenticated setup flow.
  robots: { index: false, follow: false },
};

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
