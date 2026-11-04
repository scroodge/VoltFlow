import assert from "node:assert/strict";
import test from "node:test";

import { SUPPORT_EMAIL } from "./support.ts";
import { buildPremiumUpgradeMailto, getPremiumUpgradeEmail } from "./premium-upgrade-mailto.ts";
import { getLegalOperator } from "./legal-operator.ts";

test("public contact address is the voltflow.life support mailbox", () => {
  assert.equal(SUPPORT_EMAIL, "support@voltflow.life");
});

test("premium mailto uses the shared support address", () => {
  assert.equal(getPremiumUpgradeEmail(), SUPPORT_EMAIL);
  assert.ok(buildPremiumUpgradeMailto({}).startsWith(`mailto:${SUPPORT_EMAIL}?`));
});

test("legal documents default to the shared support address", () => {
  const previous = process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL;
  delete process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL;
  try {
    assert.equal(getLegalOperator().email, SUPPORT_EMAIL);
  } finally {
    if (previous !== undefined) process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL = previous;
  }
});
