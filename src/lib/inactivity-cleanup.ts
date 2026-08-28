const DAY_MS = 24 * 60 * 60 * 1000;

export function getInactivityCutoffs(now: Date) {
  return {
    thirtyDaysAgo: new Date(now.getTime() - 30 * DAY_MS).toISOString(),
    sixtyDaysAgo: new Date(now.getTime() - 60 * DAY_MS).toISOString(),
  };
}

type InactivityProfile = {
  lastActiveAt: string | null;
  warningSentAt: string | null;
};

export function isWarningDue(profile: InactivityProfile, now: Date) {
  const { thirtyDaysAgo } = getInactivityCutoffs(now);
  return (
    profile.lastActiveAt !== null &&
    profile.lastActiveAt < thirtyDaysAgo &&
    profile.warningSentAt === null
  );
}

export function isDeletionDue(profile: InactivityProfile, now: Date) {
  const { thirtyDaysAgo, sixtyDaysAgo } = getInactivityCutoffs(now);
  return (
    profile.lastActiveAt !== null &&
    profile.lastActiveAt < sixtyDaysAgo &&
    profile.warningSentAt !== null &&
    profile.warningSentAt < thirtyDaysAgo
  );
}
