# Session detail card cleanup

## Files to change

### 1. `src/lib/i18n.ts` — Add avgPower key in all 3 locales

**English** (around line 406, after `acPower`):
```
acPower: "AC power",
avgPower: "Avg power",
```

**Belarusian** (around line 1470):
```
acPower: "AC-магутнасць",
avgPower: "Сяр. магутнасць",
```

**Russian** (around line 2534):
```
acPower: "AC-мощность",
avgPower: "Ср. мощность",
```

### 2. `src/components/charging/charging-session-screen.tsx`

#### 2a. Add avg power computation (after `displayAcPowerDecimals`, before `pctForBar`):
```
const avgPowerKw = !charging && derived.elapsedSeconds > 0
  ? session.charged_energy_kwh / (derived.elapsedSeconds / 3600)
  : 0;
```

#### 2b. Replace the stats array (lines 424-452):

Old:
```
  const chargingStats: ChargingStat[] = [
    { label: t("charging.elapsed") as string, value: formatDuration(derived.elapsedSeconds) },
    { label: t("charging.remaining") as string, value: charging ? formatDuration(derived.remainingSeconds) : "—", accent: "cyan" },
    { label: t("charging.energyDelivered") as string, value: `${derived.chargedEnergyKwh.toFixed(2)} kWh`, accent: "green" },
    { label: t("charging.currentCost") as string, value: displayCurrentCost },
    { label: t("charging.fullCost") as string, value: displayCostAtFull },
    { label: t("charging.acPower") as string, value: `${displayAcPowerKw.toFixed(displayAcPowerDecimals)} kW`, accent: "blue" },
  ];
```

New:
```
  const chargingStats: ChargingStat[] = [
    {
      label: historyMode ? (t("history.duration") as string) : (t("charging.elapsed") as string),
      value: formatDuration(derived.elapsedSeconds),
    },
    ...(!historyMode
      ? [{
          label: t("charging.remaining") as string,
          value: charging ? formatDuration(derived.remainingSeconds) : "—",
          accent: "cyan" as const,
        }]
      : []),
    {
      label: t("charging.energyDelivered") as string,
      value: `${derived.chargedEnergyKwh.toFixed(2)} kWh`,
      accent: "green",
    },
    ...(!historyMode
      ? [{
          label: t("charging.currentCost") as string,
          value: displayCurrentCost,
        }]
      : []),
    ...(!historyMode
      ? [{
          label: t("charging.fullCost") as string,
          value: displayCostAtFull,
        }]
      : []),
    {
      label: historyMode ? (t("charging.avgPower") as string) : (t("charging.acPower") as string),
      value: historyMode
        ? `${avgPowerKw.toFixed(2)} kW`
        : `${displayAcPowerKw.toFixed(displayAcPowerDecimals)} kW`,
      accent: "blue",
    },
  ];
```

## Verification

1. `npx tsc --noEmit` — should pass
2. `npm run test` — all 57 tests should pass
