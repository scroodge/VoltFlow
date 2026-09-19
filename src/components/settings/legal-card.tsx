"use client";

import { LegalSettingsRow } from "@/components/legal/legal-document-view";
import {
  SettingsGroup,
  SettingsGroupDivider,
} from "@/components/settings/settings-section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/hooks/use-translation";
import { legalDocumentPath } from "@/lib/legal-region";

export function LegalCard() {
  const { t } = useTranslation();

  return (
    <Card size="sm" className="border-white/[0.08]">
      <CardHeader>
        <CardTitle>{t("settings.legal.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-0 pb-1">
        <p className="text-muted-foreground px-4 text-sm leading-relaxed">
          {t("settings.legal.description")}
        </p>
        <SettingsGroup className="mx-4">
          <LegalSettingsRow
            href={legalDocumentPath("privacy", "world")}
            label={String(t("settings.legal.privacy"))}
          />
          <SettingsGroupDivider />
          <LegalSettingsRow
            href={legalDocumentPath("terms", "world")}
            label={String(t("settings.legal.terms"))}
          />
        </SettingsGroup>
      </CardContent>
    </Card>
  );
}
