import test from "node:test";
import assert from "node:assert/strict";

import { isDeletionDue, isWarningDue } from "./inactivity-cleanup.ts";

test("a 60-day inactive account is warned but not deleted on its first cleanup run", () => {
  const now = new Date("2026-08-27T12:00:00.000Z");
  const dormantProfile = {
    lastActiveAt: "2026-06-01T12:00:00.000Z",
    warningSentAt: null,
  };

  assert.equal(isWarningDue(dormantProfile, now), true);
  assert.equal(isDeletionDue(dormantProfile, now), false);

  const justWarnedProfile = {
    ...dormantProfile,
    warningSentAt: now.toISOString(),
  };
  assert.equal(isDeletionDue(justWarnedProfile, now), false);
});

test("deletion becomes due only after the warning has aged 30 days", () => {
  const profile = {
    lastActiveAt: "2026-06-01T12:00:00.000Z",
    warningSentAt: "2026-08-27T12:00:00.000Z",
  };

  assert.equal(isDeletionDue(profile, new Date("2026-09-26T11:59:59.000Z")), false);
  assert.equal(isDeletionDue(profile, new Date("2026-09-27T12:00:00.001Z")), true);
});

test("profiles without last activity are neither warned nor deleted", () => {
  const now = new Date("2026-08-27T12:00:00.000Z");
  const profile = {
    lastActiveAt: null,
    warningSentAt: "2026-01-01T00:00:00.000Z",
  };

  assert.equal(isWarningDue(profile, now), false);
  assert.equal(isDeletionDue(profile, now), false);
});
