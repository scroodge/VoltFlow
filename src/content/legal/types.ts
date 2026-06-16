import type { Locale } from "@/lib/i18n";
import type { LegalDocumentType, LegalRegion } from "@/lib/legal-region";

export type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type LegalDocument = {
  title: string;
  updatedAt: string;
  sections: LegalSection[];
};

export type LegalOperatorDetails = {
  name: string;
  email: string;
  address: string;
};

export type LegalContentResolver = (
  locale: Locale,
  operator: LegalOperatorDetails,
) => LegalDocument;

export type LegalDocumentKey = `${LegalDocumentType}:${LegalRegion}`;
