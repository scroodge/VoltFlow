"use client";

import { FreeRetentionNotice } from "@/components/premium/free-retention-notice";
import { AboutSection } from "@/components/settings/about-section";
import { AccountSettings } from "@/components/settings/account-settings";
import { AdminLinks } from "@/components/settings/admin-links";
import { CarsCard } from "@/components/settings/cars-card";
import { ClusterBackgroundsSettings } from "@/components/settings/cluster-backgrounds-settings";
import { DashboardVersionPanel } from "@/components/settings/dashboard-version-panel";
import { EconomicsSettings } from "@/components/settings/economic-settings";
import { LegalCard } from "@/components/settings/legal-card";
import { LocaleCard } from "@/components/settings/locale-card";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { PressureUnitSelector } from "@/components/settings/pressure-unit-selector";
import { PushDiagnostics } from "@/components/settings/push-diagnostics";
import { SettingsPageHeader } from "@/components/settings/settings-section";
import { VoltflowMateConnection } from "@/components/settings/voltflow-mate-connection";
import { Card } from "@/components/ui/card";
import { useEntitlementQuery } from "@/hooks/use-entitlement-query";
import { useProfileQuery } from "@/hooks/use-profile-query";
import { useSyncProfilePreferences } from "@/hooks/use-sync-profile-preferences";
import { useTranslation } from "@/hooks/use-translation";

export function SettingsView({ isAdmin = false }: { isAdmin?: boolean }) {
  const { t } = useTranslation();
  const { data: profile } = useProfileQuery();
  const { data: entitlement } = useEntitlementQuery();
  useSyncProfilePreferences();

  return (
    <div className="flex flex-col gap-3 px-4 pb-5 pt-3">
      <SettingsPageHeader
        eyebrow={String(t("settings.eyebrow"))}
        title={String(t("settings.title"))}
      />
      <FreeRetentionNotice />
      <CarsCard />
      <PressureUnitSelector />
      <AccountSettings />
      <NotificationSettings />

      {isAdmin ? <PushDiagnostics /> : null}
      {isAdmin ? <AdminLinks /> : null}

      <VoltflowMateConnection profileUserId={profile?.id ?? null} />
      {entitlement?.isPremium ? (
        <Card>
          <DashboardVersionPanel />
          <ClusterBackgroundsSettings />
        </Card>
      ) : null}

      <EconomicsSettings />
      <LegalCard />
      <LocaleCard />
      <AboutSection />
    </div>
  );
}
