import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";

import { resolveLegalDocument } from "@/content/legal";
import { LegalDocumentView } from "@/components/legal/legal-document-view";
import { getLegalOperator } from "@/lib/legal-operator";
import {
  isLegalDocument,
  isLegalRegion,
  type LegalDocumentType,
  type LegalRegion,
} from "@/lib/legal-region";

type PageProps = {
  params: Promise<{ document: string; region: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { document, region } = await params;
  if (!isLegalDocument(document) || !isLegalRegion(region)) {
    return { title: "Legal" };
  }

  const operator = getLegalOperator();
  const content = resolveLegalDocument(document, region, "en", operator);

  return {
    title: content.title,
    description: `VoltFlow ${document} policy (${region})`,
  };
}

export default async function LegalDocumentPage({ params }: PageProps) {
  const { document, region } = await params;

  if (!isLegalDocument(document) || !isLegalRegion(region)) {
    notFound();
  }

  const docType = document as LegalDocumentType;
  if (region === "belarus") {
    redirect(`/legal/${docType}/world`);
  }

  const operator = getLegalOperator();
  const docRegion = "world" as LegalRegion;
  const contentByLocale = {
    en: resolveLegalDocument(docType, docRegion, "en", operator),
    be: resolveLegalDocument(docType, docRegion, "be", operator),
    ru: resolveLegalDocument(docType, docRegion, "ru", operator),
  };

  return (
    <LegalDocumentView
      document={docType}
      region={docRegion}
      contentByLocale={contentByLocale}
      operatorEmail={operator.email}
    />
  );
}
