"use client";

import type { ReactNode } from "react";
import {
  Fan,
  LoaderCircle,
  Minus,
  Plus,
  Power,
  RefreshCw,
  Thermometer,
  TriangleAlert,
  Wind,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CIRCULATION_VALUES,
  climateCommandsInFlight,
  readClimateState,
  unconfirmedClimateCommand,
} from "@/lib/vehicle/climate-state";
import { cn } from "@/lib/utils";
import type {
  VehicleCommandRow,
  VoltflowMateLiveSnapshotRow,
} from "@/types/database";

export type ClimateCommand = {
  id: string;
  type: string;
  params: Record<string, unknown>;
};

const UNCONFIRMED_LABEL: Record<string, string> = {
  ac: "климат",
  ac_temp_step: "температура",
  fan_speed_step: "обдув",
  ac_recirculation: "циркуляция",
};

function formatNumber(value: number | null, suffix = "") {
  if (value == null) return "—";
  return `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`;
}

function Stepper({
  icon,
  value,
  busy,
  disabled,
  label,
  onDown,
  onUp,
}: {
  icon: ReactNode;
  value: string;
  busy: boolean;
  disabled: boolean;
  label: string;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <div
      className={cn(
        "flex h-11 items-center justify-between rounded-md border border-border/70 transition-shadow",
        busy && "ring-2 ring-primary/60",
      )}
      aria-busy={busy}
      role="group"
      aria-label={label}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-full rounded-r-none"
        disabled={disabled}
        aria-label={`${label}: меньше`}
        onClick={onDown}
      >
        <Minus className="size-4" />
      </Button>
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium tabular-nums">
        {icon}
        {busy ? (
          <LoaderCircle
            className="size-4 animate-spin"
            aria-label="Выполняется"
          />
        ) : (
          value
        )}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-full rounded-l-none"
        disabled={disabled}
        aria-label={`${label}: больше`}
        onClick={onUp}
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
}

/**
 * Compact climate controls with the car's real values: the live snapshot, overridden by the
 * before/after state Mate 0.6.5+ reads around each command (see climate-state.ts).
 */
export function ClimatePanel({
  snapshot,
  commands,
  disabled,
  pendingIds,
  onCommand,
}: {
  snapshot: VoltflowMateLiveSnapshotRow | undefined;
  commands: readonly VehicleCommandRow[] | undefined;
  disabled: boolean;
  pendingIds: readonly string[];
  onCommand: (command: ClimateCommand) => void;
}) {
  const state = readClimateState(snapshot, commands);
  const inFlight = climateCommandsInFlight(commands);
  const busyType = (type: string, idPrefix: string) =>
    inFlight.some((command) => command.type === type) ||
    pendingIds.some((id) => id.startsWith(idPrefix));
  const circBusy = (mode: "internal" | "external") =>
    inFlight.some(
      (command) =>
        command.type === "ac_recirculation" && command.params?.mode === mode,
    ) || pendingIds.includes(`recirculation-${mode}`);
  const acBusy = busyType("ac", "ac-toggle");
  const unconfirmed = unconfirmedClimateCommand(
    commands,
    // The live snapshot ticks every few seconds while this is open: a pure stand-in for now.
    snapshot ? new Date(snapshot.received_at).getTime() : 0,
  );

  const acOn = state.ac_status == null ? null : state.ac_status !== 0;
  const circ = state.ac_circ;
  const circActive = (mode: "internal" | "external") =>
    circ != null &&
    CIRCULATION_VALUES[mode] != null &&
    CIRCULATION_VALUES[mode] === circ;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="lg"
          variant={acOn ? "default" : "outline"}
          disabled={disabled}
          className={cn(
            "h-11 justify-center gap-2",
            acBusy && "ring-2 ring-primary/60",
          )}
          aria-busy={acBusy}
          aria-pressed={acOn ?? undefined}
          onClick={() =>
            onCommand({
              id: "ac-toggle",
              type: "ac",
              params: { on: acOn !== true },
            })
          }
        >
          {acBusy ? (
            <LoaderCircle
              className="size-4 animate-spin"
              aria-label="Выполняется"
            />
          ) : (
            <Power className="size-4" />
          )}
          <span className="text-sm font-medium">
            {acOn == null ? "Климат" : acOn ? "Вкл" : "Выкл"}
          </span>
        </Button>
        <div
          className="grid grid-cols-2 gap-1"
          role="group"
          aria-label="Циркуляция"
        >
          <Button
            type="button"
            size="lg"
            variant={circActive("internal") ? "default" : "outline"}
            disabled={disabled}
            className={cn(
              "h-11",
              circBusy("internal") && "ring-2 ring-primary/60",
            )}
            aria-busy={circBusy("internal")}
            aria-label="Внутренняя циркуляция"
            aria-pressed={circActive("internal")}
            onClick={() =>
              onCommand({
                id: "recirculation-internal",
                type: "ac_recirculation",
                params: { mode: "internal" },
              })
            }
          >
            {circBusy("internal") ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </Button>
          <Button
            type="button"
            size="lg"
            variant={circActive("external") ? "default" : "outline"}
            disabled={disabled}
            className={cn(
              "h-11",
              circBusy("external") && "ring-2 ring-primary/60",
            )}
            aria-busy={circBusy("external")}
            aria-label="Внешняя циркуляция"
            aria-pressed={circActive("external")}
            onClick={() =>
              onCommand({
                id: "recirculation-external",
                type: "ac_recirculation",
                params: { mode: "external" },
              })
            }
          >
            {circBusy("external") ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Wind className="size-4" />
            )}
          </Button>
        </div>
        <Stepper
          icon={<Thermometer className="size-4 text-muted-foreground" />}
          value={formatNumber(state.ac_temp_c, "°")}
          busy={busyType("ac_temp_step", "ac-temp")}
          disabled={disabled}
          label="Температура"
          onDown={() =>
            onCommand({
              id: "ac-temp-down",
              type: "ac_temp_step",
              params: { direction: "down" },
            })
          }
          onUp={() =>
            onCommand({
              id: "ac-temp-up",
              type: "ac_temp_step",
              params: { direction: "up" },
            })
          }
        />
        <Stepper
          icon={<Fan className="size-4 text-muted-foreground" />}
          value={formatNumber(state.fan_level)}
          busy={busyType("fan_speed_step", "fan-speed")}
          disabled={disabled}
          label="Обдув"
          onDown={() =>
            onCommand({
              id: "fan-speed-down",
              type: "fan_speed_step",
              params: { direction: "down" },
            })
          }
          onUp={() =>
            onCommand({
              id: "fan-speed-up",
              type: "fan_speed_step",
              params: { direction: "up" },
            })
          }
        />
      </div>
      {unconfirmed ? (
        <p className={cn("flex items-center gap-1.5 text-xs text-amber-600")}>
          <TriangleAlert className="size-3.5 shrink-0" />
          Машина не подтвердила:{" "}
          {UNCONFIRMED_LABEL[unconfirmed.type] ?? unconfirmed.type} не
          изменилась.
        </p>
      ) : null}
    </div>
  );
}
