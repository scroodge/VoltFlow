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
  const subject = "VoltFlow Premium upgrade request";
  const bodyLines = [
    "Hello, I want to upgrade to VoltFlow Premium.",
    "",
    `Account email: ${params.accountEmail ?? "not provided"}`,
    `User ID: ${params.userId ?? "not provided"}`,
    `Preferred term: ${params.desiredTerm ?? "1 year"}`,
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
