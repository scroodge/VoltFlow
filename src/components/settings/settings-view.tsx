"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Code2, ExternalLink, MessageCircle, Scale } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { deleteCar } from "@/actions/cars";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useCarsQuery } from "@/hooks/use-cars-query";
import { useTranslation } from "@/hooks/use-translation";
import {
  currencies,
  currencyLabels,
  currencySymbols,
  isCurrency,
  type Currency,
} from "@/lib/i18n";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type { Car } from "@/types/database";

export function SettingsView() {
  const router = useRouter();
  const { data: cars, isLoading } = useCarsQuery();
  const [email, setEmail] = useState<string | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const defaultPricePerKwh = useAppPreferences((s) => s.defaultPricePerKwh);
  const setDefaultPrice = useAppPreferences((s) => s.setDefaultPricePerKwh);
  const currency = useAppPreferences((s) => s.currency);
  const setCurrency = useAppPreferences((s) => s.setCurrency);
  const { t } = useTranslation();
  useEffect(() => {
    let mounted = true;
    const supabase = createClient();

    void supabase.auth.getUser().then(async ({ data }) => {
      const user = data.user;
      if (!mounted) return;

      setEmail(user?.email ?? null);
      setProfileUserId(user?.id ?? null);
      if (!user) return;

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("preferred_currency")
        .eq("id", user.id)
        .single();

      if (!mounted || error) return;

      const preferredCurrency = profile?.preferred_currency;
      if (typeof preferredCurrency === "string" && isCurrency(preferredCurrency)) {
        setCurrency(preferredCurrency);
      }
    });

    return () => {
      mounted = false;
    };
  }, [setCurrency]);

  const handlePriceSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numeric = Number(
      String(new FormData(event.currentTarget).get("pref-price") ?? ""),
    );
    if (!Number.isFinite(numeric) || numeric < 0) {
      toast.error(t("settings.tariffPositive") as string);
      return;
    }
    setDefaultPrice(numeric);
    toast.success(t("settings.tariffSaved") as string);
  };

  const handleCurrencyChange = (value: Currency | null) => {
    if (!value || !isCurrency(value)) return;
    const previous = currency;
    setCurrency(value);

    if (!profileUserId) {
      toast.success(t("settings.currencySaved") as string);
      return;
    }

    void createClient()
      .from("profiles")
      .update({ preferred_currency: value })
      .eq("id", profileUserId)
      .then(({ error }) => {
        if (error) {
          setCurrency(previous);
          toast.error(error.message);
          return;
        }
        toast.success(t("settings.currencySaved") as string);
      });
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success(t("settings.signedOut") as string);
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <p className="text-muted-foreground text-xs uppercase tracking-[0.3em]">
          {t("settings.eyebrow")}
        </p>
        <h1 className="mt-2 text-balance text-4xl font-semibold tracking-tight">
          {t("settings.title")}
        </h1>
        <p className="text-muted-foreground mt-3 max-w-2xl text-lg">
          {t("settings.subtitle")}
        </p>
      </div>

      <Card className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">{t("locale.label")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocaleSwitcher />
          <p className="text-muted-foreground text-sm">{t("locale.helper")}</p>
        </CardContent>
      </Card>

      <Card className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">{t("settings.account")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-base leading-relaxed">
          <div>
            <p className="text-muted-foreground text-sm uppercase tracking-[0.3em]">
              {t("settings.email")}
            </p>
            {email === null ? (
              <Skeleton className="mt-4 h-[22px] w-2/5 rounded-xl" />
            ) : (
              <p className="mt-4 text-lg">{email ?? t("common.unavailable")}</p>
            )}
          </div>

          <Button
            className="h-[54px] w-full rounded-full text-base font-semibold"
            variant="outline"
            type="button"
            onClick={() => void handleSignOut()}
          >
            {t("settings.signOut")}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">{t("settings.economics")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          <form className="space-y-4" onSubmit={handlePriceSave}>
            <div className="space-y-4">
              <Label htmlFor="pref-currency">{t("settings.currency")}</Label>
              <Select
                value={currency}
                onValueChange={handleCurrencyChange}
                items={currencies.map((item) => ({
                  value: item,
                  label: currencyLabels[item],
                }))}
              >
                <SelectTrigger
                  id="pref-currency"
                  className="h-[54px] w-full rounded-2xl text-lg"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((item) => (
                    <SelectItem key={item} value={item}>
                      {currencyLabels[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-sm">
                {t("settings.currencyHelp")}
              </p>
            </div>

            <Label htmlFor="pref-price">
              {t("settings.tariff", { currency: currencySymbols[currency] })}
            </Label>
            <Input
              key={defaultPricePerKwh}
              id="pref-price"
              name="pref-price"
              type="number"
              step="any"
              defaultValue={String(defaultPricePerKwh)}
              inputMode="decimal"
              min={0}
              className="h-[54px] rounded-2xl text-lg"
              required
            />
            <p className="text-muted-foreground text-sm">
              {t("settings.tariffHelp")}
            </p>
            <Button className="h-[52px] w-full rounded-full text-base font-semibold" type="submit">
              {t("settings.storeDefault")}
            </Button>
          </form>
          <Separator className="my-16 bg-white/15" />

          <div className="space-y-8">
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-6">
                <p className="text-xs uppercase tracking-[0.38em] text-muted-foreground">
                  {t("settings.housekeeping")}
                </p>
                <p className="text-lg leading-relaxed text-muted-foreground">
                  {t("settings.housekeepingBody")}
                </p>
              </div>
              <Button asChild variant="secondary" size="lg" className="h-[54px] rounded-full">
                <Link href="/cars/new">{t("settings.addEv")}</Link>
              </Button>
            </div>
            <div className="space-y-5">
              {isLoading &&
                Array.from({ length: 2 }).map((_, index) => (
                  <Skeleton key={index} className="h-[120px] w-full rounded-3xl" />
                ))}
              {!isLoading &&
                cars?.map((car) => (
                  <CarRow key={car.id} car={car} />
                ))}
              {!isLoading && !(cars ?? []).length ? (
                <p className="text-muted-foreground text-base leading-relaxed">
                  {t("settings.noRides")}
                </p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <PrivacyNote />
      <AboutSection />
    </div>
  );
}

function CarRow({ car }: { car: Car }) {
  const { t } = useTranslation();
  const handleDelete = async () => {
    if (!confirm(t("settings.removeConfirm", { name: car.name }) as string)) return;
    const res = await deleteCar(car.id);
    if (!res.ok) {
      toast.error(
        typeof res.error === "string" ? res.error : (t("settings.deleteError") as string),
      );
      return;
    }
    toast.success(t("settings.removed", { name: car.name }) as string);
  };

  return (
    <div className="border-white/[0.08] flex flex-wrap items-start justify-between gap-6 rounded-3xl border bg-white/[0.02] px-6 py-6">
      <div>
        <p className="text-lg font-semibold tracking-tight">{car.name}</p>
        <p className="text-muted-foreground text-base">
          {t("settings.pedestal", {
            battery: car.battery_capacity_kwh,
            power: car.default_charger_power_kw,
          })}
        </p>
      </div>
      <Button
        variant="ghost"
        size="lg"
        className="rounded-full px-11 text-[15px]"
        type="button"
        onClick={() => void handleDelete()}
      >
        {t("settings.remove")}
      </Button>
    </div>
  );
}

function PrivacyNote() {
  const { t } = useTranslation();
  const privacyItems = t("settings.privacyItems") as readonly string[];

  return (
    <div className="text-muted-foreground border-white/[0.08] mx-auto rounded-3xl border bg-white/[0.02] px-8 py-16 text-lg leading-relaxed">
      {t("settings.privacy")}
      <Separator className="my-14 bg-transparent" />
      <p className="text-muted-foreground/80 text-[13px] uppercase tracking-[0.45em]">
        {t("settings.privacyTitle")}
      </p>
      <ul className="mt-14 list-none space-y-8 text-muted-foreground/90 tracking-tight">
        {privacyItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function AboutSection() {
  const { t } = useTranslation();

  return (
    <Card className="border-white/[0.08]">
      <CardHeader>
        <CardTitle className="text-xl tracking-tight">{t("settings.about")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-muted-foreground text-base leading-relaxed">
          {t("settings.aboutBody")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            asChild
            variant="secondary"
            size="lg"
            className="h-[54px] justify-between rounded-full px-5 text-base font-semibold"
          >
            <a
              href="https://t.me/bydyuanupbuybelarus"
              target="_blank"
              rel="noreferrer"
            >
              <span className="inline-flex items-center gap-3">
                <MessageCircle className="size-5" aria-hidden />
                {t("settings.telegram")}
              </span>
              <ExternalLink className="size-4" aria-hidden />
            </a>
          </Button>
          <Button
            asChild
            variant="secondary"
            size="lg"
            className="h-[54px] justify-between rounded-full px-5 text-base font-semibold"
          >
            <a
              href="https://github.com/scroodge/EvACChargeApp"
              target="_blank"
              rel="noreferrer"
            >
              <span className="inline-flex items-center gap-3">
                <Code2 className="size-5" aria-hidden />
                {t("settings.github")}
              </span>
              <ExternalLink className="size-4" aria-hidden />
            </a>
          </Button>
        </div>
        <Separator className="bg-white/15" />
        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p className="flex items-start gap-3">
            <Scale className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t("settings.license")}</span>
          </p>
          <p>{t("settings.copyright")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
