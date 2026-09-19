"use client";

import { toast } from "sonner";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/hooks/use-translation";
import { useUpdateProfile } from "@/hooks/use-update-profile";
import { isLocale, type Locale } from "@/lib/i18n";
import { useAppPreferences } from "@/stores/use-app-preferences";

export function LocaleCard() {
  const { t } = useTranslation();
  const updateProfile = useUpdateProfile();
  const setLocale = useAppPreferences((s) => s.setLocale);

  const handleLocaleChange = async (value: Locale, previous: Locale) => {
    if (!isLocale(value)) return;

    const result = await updateProfile({ preferred_locale: value });
    if (!result.ok) {
      setLocale(previous);
      toast.error(result.error);
      return;
    }
    toast.success(t("settings.localeSaved") as string);
  };

  return (
    <Card size="sm" className="border-white/[0.08]">
      <CardHeader>
        <CardTitle>{t("locale.label")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <LocaleSwitcher onLocaleChange={handleLocaleChange} />
        <p className="text-muted-foreground text-sm">{t("locale.helper")}</p>
      </CardContent>
    </Card>
  );
}
