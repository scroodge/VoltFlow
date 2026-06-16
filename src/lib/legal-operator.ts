/** Operator details shown in legal documents. Override via env before production. */
export function getLegalOperator() {
  return {
    name: process.env.NEXT_PUBLIC_LEGAL_OPERATOR_NAME?.trim() || "VoltFlow",
    email: process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim() || "washjurine@gmail.com",
    address:
      process.env.NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS?.trim() ||
      "Republic of Belarus",
  };
}
