"use client";

import { useSeedDefaultUserProviders } from "@/hooks/use-user-providers-query";

/** Mounted globally (MobileShell) so a new user's provider list is seeded
 * regardless of which page they open first. */
export function DefaultProvidersSeed() {
  useSeedDefaultUserProviders();
  return null;
}
