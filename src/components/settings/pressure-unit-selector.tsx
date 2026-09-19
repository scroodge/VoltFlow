"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useProfileQuery } from "@/hooks/use-profile-query";
import { useTranslation } from "@/hooks/use-translation";
import { useUpdateProfile } from "@/hooks/use-update-profile";
import { type TranslationKey } from "@/lib/i18n";
import {
  defaultPressureUnit,
  isPressureUnit,
  pressureUnits,
  type PressureUnit,
} from "@/lib/pressure-units";

export function PressureUnitSelector() {
  const { t } = useTranslation();
  const { data: profile } = useProfileQuery();
  const updateProfile = useUpdateProfile();
  const [saving, setSaving] = useState(false);

  const storedUnit = profile?.preferred_pressure_unit;
  const pressureUnit = isPressureUnit(storedUnit)
    ? storedUnit
    : defaultPressureUnit;

  const handleChange = async (value: PressureUnit | null) => {
    if (!value || !isPressureUnit(value) || !profile) return;

    setSaving(true);
    try {
      const result = await updateProfile({ preferred_pressure_unit: value });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("settings.pressureUnit.saved") as string);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card size="sm" className="border-white/[0.08]">
      <CardHeader>
        <CardTitle>{t("settings.pressureUnit.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <details className="group rounded-2xl border border-white/[0.08] bg-white/[0.03]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
            <span>{t("settings.pressureUnit.displayUnit")}</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              {t(
                `settings.pressureUnit.units.${pressureUnit}` as TranslationKey,
              )}
              <ChevronDown
                className="size-4 transition-transform group-open:rotate-180"
                aria-hidden
              />
            </span>
          </summary>
          <div className="space-y-3 border-t border-white/[0.08] px-4 py-4">
            <Label htmlFor="pref-pressure-unit">
              {t("settings.pressureUnit.displayUnit")}
            </Label>
            <Select
              value={pressureUnit}
              onValueChange={(value) => void handleChange(value)}
              items={pressureUnits.map((unit) => ({
                value: unit,
                label: t(
                  `settings.pressureUnit.units.${unit}` as TranslationKey,
                ),
              }))}
            >
              <SelectTrigger
                id="pref-pressure-unit"
                className="h-11 w-full rounded-2xl text-sm"
                disabled={!profile || saving}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pressureUnits.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {t(`settings.pressureUnit.units.${unit}` as TranslationKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {t("settings.pressureUnit.help")}
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
