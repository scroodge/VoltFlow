export function isPremiumFromUntil(
  premiumUntil: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!premiumUntil) return false;
  const parsed = Date.parse(premiumUntil);
  return Number.isFinite(parsed) && parsed > nowMs;
}

export function resolveEffectivePremium(params: {
  isAdmin: boolean;
  isPremiumFlag: boolean;
  premiumUntil: string | null | undefined;
  nowMs?: number;
}): boolean {
  if (params.isAdmin) return true;
  if (params.isPremiumFlag) return true;
  return isPremiumFromUntil(params.premiumUntil, params.nowMs);
}
