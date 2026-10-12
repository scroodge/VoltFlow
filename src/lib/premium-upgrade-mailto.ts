const PREMIUM_UPGRADE_EMAIL = "washjurine@gmail.com";

export function getPremiumUpgradeEmail() {
  return PREMIUM_UPGRADE_EMAIL;
}

export function buildPremiumUpgradeMailto(params: {
  accountEmail?: string | null;
  userId?: string | null;
  locale?: string | null;
  desiredTerm?: string;
  note?: string;
}) {
  const subject = "VoltFlow account access question";
  const bodyLines = [
    "Hello, I have a question about my VoltFlow account access.",
    "",
    `Account email: ${params.accountEmail ?? "not provided"}`,
    `User ID: ${params.userId ?? "not provided"}`,
    `Requested period, if applicable: ${params.desiredTerm ?? "not specified"}`,
    `App language: ${params.locale ?? "unknown"}`,
    "",
    `Note: ${params.note ?? ""}`,
  ];
  const query = new URLSearchParams({
    subject,
    body: bodyLines.join("\n"),
  });
  return `mailto:${PREMIUM_UPGRADE_EMAIL}?${query.toString()}`;
}
