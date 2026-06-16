import type { Locale } from "@/lib/i18n";

export type LegalRegion = "world" | "belarus";

export const legalRegions: LegalRegion[] = ["world", "belarus"];

export type LegalDocumentType = "privacy" | "terms";

export const legalDocuments: LegalDocumentType[] = ["privacy", "terms"];

export function isLegalRegion(value: string): value is LegalRegion {
  return legalRegions.includes(value as LegalRegion);
}

export function isLegalDocument(value: string): value is LegalDocumentType {
  return legalDocuments.includes(value as LegalDocumentType);
}

export function recommendedLegalRegion(_locale?: Locale): LegalRegion {
  return "world";
}

export function legalDocumentPath(
  document: LegalDocumentType,
  region: LegalRegion,
): string {
  return `/legal/${document}/${region}`;
}
