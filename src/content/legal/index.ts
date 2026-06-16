import type { Locale } from "@/lib/i18n";
import { getPrivacyBelarus } from "@/content/legal/privacy-belarus";
import { getPrivacyWorld } from "@/content/legal/privacy-world";
import { getTermsBelarus } from "@/content/legal/terms-belarus";
import { getTermsWorld } from "@/content/legal/terms-world";
import type { LegalDocument, LegalOperatorDetails } from "@/content/legal/types";
import type { LegalDocumentType, LegalRegion } from "@/lib/legal-region";

export function resolveLegalDocument(
  document: LegalDocumentType,
  region: LegalRegion,
  locale: Locale,
  operator: LegalOperatorDetails,
): LegalDocument {
  if (document === "privacy" && region === "world") {
    return getPrivacyWorld(locale, operator);
  }
  if (document === "privacy" && region === "belarus") {
    return getPrivacyBelarus(locale, operator);
  }
  if (document === "terms" && region === "world") {
    return getTermsWorld(locale, operator);
  }
  return getTermsBelarus(locale, operator);
}
