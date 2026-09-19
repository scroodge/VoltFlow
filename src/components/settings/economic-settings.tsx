import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useTranslation } from "@/hooks/use-translation";
import { type TranslationKey } from "@/lib/i18n";
import { CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EconomicsSettings({
  handleCurrencyChange,
  handlePriceSave,
  currency,
  currencyLabels,
  currencies,
  homePricePerKwh,
  currencyTextWithIcon,
  currencySymbols,
  commercialAcPricePerKwh,
  fastDcPricePerKwh,
  tariffSaveState,
  handleSaveProviderPrices,
  userProviderRows,
  selectedProviderIds,
  handleToggleProvider,
  setSelectedProviderIds,
  handleDeleteSelectedProviders,
  providerPricesSaving,
  newProviderLabel,
  setNewProviderLabel,
  newProviderAc,
  setNewProviderAc,
  newProviderDc,
  setNewProviderDc,
  newLocationNameInputRef,
  newLocationName,
  handleAddUserProvider,
  newProviderSaving,
  setNewLocationName,
  setNewLocationNameError,
  newLocationNameError,
  handleUseCurrentGps,
  newLocationAutoGps,
  setNewLocationAutoGps,
  setNewLocationLat,
  setNewLocationLng,
  newLocationRadius,
  setNewLocationRadius,
  newLocationTariffType,
  setNewLocationTariffType,
  newLocationUserProviderId,
  newLocationProviderType,
  parseLocationProviderValue,
  setNewLocationProviderType,
  setNewLocationUserProviderId,
  locationProviderOptions,
  TariffLocationMapPreview,
  tariffMapLat,
  tariffMapLng,
  hasNewLocationCoords,
  parsedNewLocationLat,
  parsedNewLocationLng,
  newLocationOverridePrice,
  setNewLocationOverridePrice,
  handleAddTariffLocation,
  tariffLocations,
  handleDeleteTariffLocation,
  ChargingTariffType,
  Currency,
}: {
  handleCurrencyChange: any;
  handlePriceSave: any;
  currency: string | null;
  currencies: any;
  currencyLabels: any;
  homePricePerKwh: any;
  currencyTextWithIcon: any;
  currencySymbols: any;
  commercialAcPricePerKwh: any;
  fastDcPricePerKwh: any;
  tariffSaveState: any;
  handleSaveProviderPrices: any;
  userProviderRows: any;
  selectedProviderIds: any;
  handleToggleProvider: any;
  setSelectedProviderIds: any;
  handleDeleteSelectedProviders: any;
  providerPricesSaving: any;
  newProviderLabel: any;
  setNewProviderLabel: any;
  newProviderAc: any;
  setNewProviderAc: any;
  newProviderDc: any;
  setNewProviderDc: any;
  newLocationNameInputRef: any;
  newLocationName: any;
  handleAddUserProvider: any;
  newProviderSaving: any;
  setNewLocationName: any;
  setNewLocationNameError: any;
  newLocationNameError: any;
  handleUseCurrentGps: any;
  newLocationAutoGps: any;
  setNewLocationAutoGps: any;
  setNewLocationLat: any;
  setNewLocationLng: any;
  newLocationRadius: any;
  setNewLocationRadius: any;
  newLocationTariffType: any;
  setNewLocationTariffType: any;
  newLocationUserProviderId: any;
  newLocationProviderType: any;
  parseLocationProviderValue: any;
  setNewLocationProviderType: any;
  setNewLocationUserProviderId: any;
  locationProviderOptions: any;
  TariffLocationMapPreview: any;
  tariffMapLat: any;
  tariffMapLng: any;
  hasNewLocationCoords: any;
  parsedNewLocationLat: any;
  parsedNewLocationLng: any;
  newLocationOverridePrice: any;
  setNewLocationOverridePrice: any;
  handleAddTariffLocation: any;
  tariffLocations: any;
  handleDeleteTariffLocation: any;
  ChargingTariffType: any;
  Currency: any;
}) {
  const { t } = useTranslation();
  return (
    <Card size="sm" className="border-white/[0.08]">
      <CardHeader>
        <CardTitle>{t("settings.economics")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <form className="space-y-4" onSubmit={handlePriceSave}>
          <div className="space-y-4">
            <Label htmlFor="pref-currency">{t("settings.currency")}</Label>
            <Select
              value={currency}
              onValueChange={handleCurrencyChange}
              items={currencies.map((item: any) => ({
                value: item,
                label: currencyLabels[item],
              }))}
            >
              <SelectTrigger
                id="pref-currency"
                className="h-11 w-full rounded-2xl text-sm"
              >
                <SelectValue>
                  {(value: typeof Currency | null) =>
                    value
                      ? currencyTextWithIcon(currencyLabels[value], value)
                      : null
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {currencies.map((item: any) => (
                  <SelectItem key={item} value={item}>
                    {currencyTextWithIcon(currencyLabels[item], item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-sm">
              {t("settings.currencyHelp")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pref-price-home">
              {currencyTextWithIcon(
                t("settings.locationTariffs.homeTariff", {
                  currency: currencySymbols[typeof currency],
                }) as string,
                currency,
              )}
            </Label>
            <Input
              key={homePricePerKwh}
              id="pref-price-home"
              name="pref-price-home"
              type="text"
              step="any"
              defaultValue={String(homePricePerKwh)}
              inputMode="decimal"
              pattern="[0-9]*[,.]?[0-9]*"
              min={0}
              className="h-11 rounded-2xl text-sm"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pref-price-ac">
              {currencyTextWithIcon(
                t("settings.locationTariffs.acTariff", {
                  currency: currencySymbols[typeof currency],
                }) as string,
                currency,
              )}
            </Label>
            <Input
              key={commercialAcPricePerKwh}
              id="pref-price-ac"
              name="pref-price-ac"
              type="text"
              step="any"
              defaultValue={String(commercialAcPricePerKwh)}
              inputMode="decimal"
              pattern="[0-9]*[,.]?[0-9]*"
              min={0}
              className="h-11 rounded-2xl text-sm"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pref-price-dc">
              {currencyTextWithIcon(
                t("settings.locationTariffs.dcTariff", {
                  currency: currencySymbols[typeof currency],
                }) as string,
                currency,
              )}
            </Label>
            <Input
              key={fastDcPricePerKwh}
              id="pref-price-dc"
              name="pref-price-dc"
              type="text"
              step="any"
              defaultValue={String(fastDcPricePerKwh)}
              inputMode="decimal"
              pattern="[0-9]*[,.]?[0-9]*"
              min={0}
              className="h-11 rounded-2xl text-sm"
              required
            />
          </div>
          <p className="text-muted-foreground text-sm">
            {t("settings.locationTariffs.autoTierHint") as string}
          </p>
          <Button
            className="h-11 w-full rounded-full text-sm font-semibold"
            type="submit"
            disabled={tariffSaveState === "saving"}
          >
            {tariffSaveState === "saving" ? (
              <>
                <Loader2 className="animate-spin" />
                {t("settings.tariffSaving")}
              </>
            ) : tariffSaveState === "saved" ? (
              <>
                <CheckCircle2 />
                {t("settings.tariffSavedShort")}
              </>
            ) : (
              t("settings.storeDefault")
            )}
          </Button>
        </form>

        <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
          <div>
            <p className="text-sm font-semibold tracking-tight">
              {t("settings.providerTariffs.userProvidersTitle") as string}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("settings.providerTariffs.userProvidersBody") as string}
            </p>
          </div>

          <form onSubmit={handleSaveProviderPrices} className="space-y-3">
            {userProviderRows.map((provider: any) => (
              <div key={provider.id} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  {!provider.is_default ? (
                    <input
                      type="checkbox"
                      checked={selectedProviderIds.includes(provider.id)}
                      onChange={() => handleToggleProvider(provider.id)}
                      aria-label={`${provider.label} ${t("settings.providerTariffs.deleteSelected") as string}`}
                      className="size-4 accent-destructive"
                    />
                  ) : null}
                  <Label className="text-sm">{provider.label}</Label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    key={`${provider.id}-ac-${provider.commercial_ac_price_per_kwh}`}
                    name={`provider-${provider.id}-ac`}
                    aria-label={`${provider.label} ${t("settings.providerTariffs.acLabel") as string}`}
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*[,.]?[0-9]*"
                    defaultValue={String(provider.commercial_ac_price_per_kwh)}
                    className="h-11 rounded-2xl text-sm"
                  />
                  <Input
                    key={`${provider.id}-dc-${provider.fast_dc_price_per_kwh}`}
                    name={`provider-${provider.id}-dc`}
                    aria-label={`${provider.label} ${t("settings.providerTariffs.dcLabel") as string}`}
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*[,.]?[0-9]*"
                    defaultValue={String(provider.fast_dc_price_per_kwh)}
                    className="h-11 rounded-2xl text-sm"
                  />
                </div>
              </div>
            ))}
            {selectedProviderIds.length > 0 ? (
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedProviderIds([])}
                  className="text-xs text-muted-foreground underline underline-offset-2"
                >
                  {t("settings.providerTariffs.cancelSelection") as string}
                </button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-9 rounded-full text-xs"
                  onClick={handleDeleteSelectedProviders}
                >
                  <Trash2 className="mr-1 size-3.5" />
                  {t("settings.providerTariffs.deleteSelected") as string} (
                  {selectedProviderIds.length})
                </Button>
              </div>
            ) : (
              <Button
                className="h-11 w-full rounded-full text-sm font-semibold"
                type="submit"
                disabled={providerPricesSaving}
              >
                {providerPricesSaving ? (
                  <Loader2 className="animate-spin" />
                ) : null}
                {t("settings.providerTariffs.save") as string}
              </Button>
            )}
          </form>

          {selectedProviderIds.length === 0 ? (
            <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {t("settings.providerTariffs.addProviderLabel") as string}
                </Label>
                <Input
                  value={newProviderLabel}
                  onChange={(e) => setNewProviderLabel(e.target.value)}
                  placeholder={
                    t("settings.providerTariffs.addProviderLabel") as string
                  }
                  className="h-10 rounded-xl text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {t("settings.providerTariffs.addProviderAc") as string}
                </Label>
                <Input
                  value={newProviderAc}
                  onChange={(e) => setNewProviderAc(e.target.value)}
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[,.]?[0-9]*"
                  placeholder="0.00"
                  className="h-10 rounded-xl text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {t("settings.providerTariffs.addProviderDc") as string}
                </Label>
                <Input
                  value={newProviderDc}
                  onChange={(e) => setNewProviderDc(e.target.value)}
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[,.]?[0-9]*"
                  placeholder="0.00"
                  className="h-10 rounded-xl text-sm"
                />
              </div>
              <Button
                type="button"
                onClick={handleAddUserProvider}
                disabled={newProviderSaving}
                className="h-10 rounded-xl text-sm"
              >
                {newProviderSaving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  (t("settings.providerTariffs.addProviderSave") as string)
                )}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
          <p className="text-sm font-semibold tracking-tight">
            {t("settings.locationTariffs.title") as string}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Input
                ref={newLocationNameInputRef}
                placeholder={
                  t("settings.locationTariffs.namePlaceholder") as string
                }
                value={newLocationName}
                onChange={(event) => {
                  setNewLocationName(event.target.value);
                  if (event.target.value.trim()) {
                    setNewLocationNameError(false);
                  }
                }}
                aria-invalid={newLocationNameError}
                aria-describedby={
                  newLocationNameError
                    ? "tariff-location-name-error"
                    : undefined
                }
                className="h-11 rounded-2xl text-sm"
              />
              {newLocationNameError ? (
                <p
                  id="tariff-location-name-error"
                  className="px-1 text-xs font-medium text-destructive"
                >
                  {t("settings.locationTariffs.nameRequired") as string}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-full text-sm"
              onClick={handleUseCurrentGps}
            >
              {t("settings.locationTariffs.useCurrentGps") as string}
            </Button>
            <Button
              type="button"
              variant={newLocationAutoGps ? "secondary" : "outline"}
              className="h-11 rounded-full text-sm"
              onClick={() => {
                const next = !newLocationAutoGps;
                setNewLocationAutoGps(next);
                if (next && navigator.geolocation) {
                  navigator.geolocation.getCurrentPosition(
                    (position) => {
                      const lat = position.coords.latitude;
                      const lon = position.coords.longitude;
                      setNewLocationLat(String(lat));
                      setNewLocationLng(String(lon));
                    },
                    () => {},
                    {
                      enableHighAccuracy: true,
                      timeout: 8000,
                      maximumAge: 60000,
                    },
                  );
                }
              }}
            >
              {newLocationAutoGps
                ? (t("settings.locationTariffs.autoGpsOn") as string)
                : (t("settings.locationTariffs.autoGpsOff") as string)}
            </Button>
            <Input
              placeholder={
                t("settings.locationTariffs.radiusPlaceholder") as string
              }
              value={newLocationRadius}
              onChange={(event) => setNewLocationRadius(event.target.value)}
              className="h-11 rounded-2xl text-sm"
            />
            <Select
              value={newLocationTariffType}
              onValueChange={(value) =>
                setNewLocationTariffType(value as typeof ChargingTariffType)
              }
              items={(["home", "commercial_ac", "fast_dc"] as const).map(
                (value) => ({
                  value,
                  label: t(`charging.tariff.types.${value}` as TranslationKey),
                }),
              )}
            >
              <SelectTrigger className="h-11 rounded-2xl text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["home", "commercial_ac", "fast_dc"] as const).map(
                  (value) => (
                    <SelectItem key={value} value={value}>
                      {t(`charging.tariff.types.${value}` as TranslationKey)}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <Select
              value={
                newLocationUserProviderId
                  ? `up_${newLocationUserProviderId}`
                  : newLocationProviderType
              }
              onValueChange={(value) => {
                const parsed = parseLocationProviderValue(value);
                setNewLocationProviderType(parsed.providerType);
                setNewLocationUserProviderId(parsed.userProviderId);
              }}
              items={locationProviderOptions.map((item: any) => ({
                value: item.value,
                label: item.label,
              }))}
            >
              <SelectTrigger className="h-11 rounded-2xl text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {locationProviderOptions.map((item: any) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TariffLocationMapPreview lat={tariffMapLat} lng={tariffMapLng} />
          {hasNewLocationCoords ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t("settings.locationTariffs.pointCoords", {
                  lat: parsedNewLocationLat.toFixed(6),
                  lon: parsedNewLocationLng.toFixed(6),
                })}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("settings.locationTariffs.gpsPending") as string}
            </p>
          )}
          <Input
            placeholder={
              t("settings.locationTariffs.optionalPrice", {
                currency: currencySymbols[typeof currency],
              }) as string
            }
            value={newLocationOverridePrice}
            onChange={(event) =>
              setNewLocationOverridePrice(event.target.value)
            }
            className="h-11 rounded-2xl text-sm"
          />
          <Button
            type="button"
            className="h-11 w-full rounded-full text-sm font-semibold"
            onClick={handleAddTariffLocation}
          >
            {t("settings.locationTariffs.save") as string}
          </Button>
          <div className="space-y-2">
            {tariffLocations.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("settings.locationTariffs.empty") as string}
              </p>
            ) : (
              tariffLocations.map((location: any) => (
                <div
                  key={location.id}
                  className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{location.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {location.provider_type} · {location.tariff_type} ·{" "}
                      {location.radius_m} m · {location.lat.toFixed(5)},{" "}
                      {location.lng.toFixed(5)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-full text-xs"
                    onClick={() => handleDeleteTariffLocation(location.id)}
                  >
                    {t("settings.locationTariffs.delete") as string}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
