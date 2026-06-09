"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AirVent, PanelBottomClose, PanelTopOpen, Snowflake, Wind } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import {
  useSendVehicleCommand,
  useVehicleCommandsQuery,
} from "@/hooks/use-vehicle-commands-query";
import {
  isControlAllowed,
  isRemoteReady,
  isTelemetryFresh,
  readAuxVoltage,
  readGear,
  readSentryProvider,
  readSpeed,
  VEHICLE_CONTROL_LOW_AUX_V,
  VEHICLE_CONTROL_STALE_MS,
} from "@/lib/vehicle/vehicle-control-guards";
import type { BydmateLiveSnapshotRow, VehicleCommandRow } from "@/types/database";

function statusLabel(status: VehicleCommandRow["status"]) {
  switch (status) {
    case "pending":
      return "В очереди";
    case "sent":
      return "Отправлено";
    case "done":
      return "Выполнено";
    case "failed":
      return "Ошибка";
    case "rejected":
      return "Отклонено";
    default:
      return status;
  }
}

type ComfortAction = {
  id: string;
  label: string;
  type: string;
  params: Record<string, unknown>;
  icon: ReactNode;
  variant?: "default" | "outline" | "secondary";
};

const WINDOW_ACTIONS: ComfortAction[] = [
  {
    id: "windows-vent",
    label: "Проветривание",
    type: "windows_preset",
    params: { preset: "vent" },
    icon: <Wind className="size-4" />,
    variant: "secondary",
  },
  {
    id: "windows-open",
    label: "Открыть все",
    type: "windows_preset",
    params: { preset: "open" },
    icon: <PanelTopOpen className="size-4" />,
  },
  {
    id: "windows-close",
    label: "Закрыть все",
    type: "windows_preset",
    params: { preset: "close" },
    icon: <PanelBottomClose className="size-4" />,
    variant: "outline",
  },
];

const CLIMATE_ACTIONS: ComfortAction[] = [
  {
    id: "ac-on",
    label: "Кондиционер вкл",
    type: "ac",
    params: { on: true },
    icon: <Snowflake className="size-4" />,
  },
  {
    id: "ac-off",
    label: "Кондиционер выкл",
    type: "ac",
    params: { on: false },
    icon: <Snowflake className="size-4 opacity-50" />,
    variant: "outline",
  },
  {
    id: "vent-on",
    label: "Вентиляция вкл",
    type: "ac_vent",
    params: { on: true },
    icon: <AirVent className="size-4" />,
    variant: "secondary",
  },
  {
    id: "vent-off",
    label: "Вентиляция выкл",
    type: "ac_vent",
    params: { on: false },
    icon: <AirVent className="size-4 opacity-50" />,
    variant: "outline",
  },
];

function ActionGrid({
  actions,
  disabled,
  pendingId,
  onAction,
  columns = 3,
}: {
  actions: ComfortAction[];
  disabled: boolean;
  pendingId: string | null;
  onAction: (action: ComfortAction) => void;
  columns?: 2 | 3;
}) {
  const columnClass = columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3";

  return (
    <div className={`grid grid-cols-1 gap-2 ${columnClass}`}>
      {actions.map((action) => (
        <Button
          key={action.id}
          type="button"
          size="lg"
          variant={action.variant ?? "default"}
          disabled={disabled || pendingId === action.id}
          className="h-auto min-h-11 justify-start gap-2 px-3 py-2.5 text-left whitespace-normal"
          onClick={() => onAction(action)}
        >
          {action.icon}
          <span className="text-sm font-medium leading-tight">{action.label}</span>
        </Button>
      ))}
    </div>
  );
}

export type VehicleComfortControlsProps = {
  vehicleId: string | null;
  /** Dev only: allow enqueue without fresh parked live snapshot. */
  relaxGuards?: boolean;
};

export function VehicleComfortControls({
  vehicleId,
  relaxGuards = false,
}: VehicleComfortControlsProps) {
  const { data: liveRows } = useBydmateLiveQuery();
  const { data: commands } = useVehicleCommandsQuery(vehicleId);
  const sendCommand = useSendVehicleCommand(vehicleId);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const snapshot = useMemo(() => {
    if (!vehicleId) return undefined;
    return liveRows?.find((row) => row.vehicle_id === vehicleId);
  }, [liveRows, vehicleId]);

  const allowed = relaxGuards || isControlAllowed(snapshot);
  const remoteReady = relaxGuards || isRemoteReady(snapshot);
  const stale =
    !relaxGuards &&
    snapshot != null &&
    Date.now() - new Date(snapshot.received_at).getTime() > VEHICLE_CONTROL_STALE_MS;
  const aux = readAuxVoltage(snapshot);
  const lowAux = !relaxGuards && aux != null && aux > 0 && aux < VEHICLE_CONTROL_LOW_AUX_V;
  const disabled = !vehicleId || !allowed || sendCommand.isPending;

  async function runAction(action: ComfortAction) {
    setPendingId(action.id);
    try {
      await sendCommand.mutateAsync({ type: action.type, params: action.params });
    } finally {
      setPendingId(null);
    }
  }

  if (!vehicleId) return null;

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Удалённое управление</CardTitle>
        <CardDescription>Окна и климат. Только на стоянке (P, 0 км/ч).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <StatusRow snapshot={snapshot} remoteReady={remoteReady} aux={aux} />

        {stale ? (
          <p className="text-sm text-amber-600">Нет свежих данных с машины (&gt;90 с).</p>
        ) : null}
        {lowAux ? (
          <p className="text-sm text-amber-600">
            Низкое напряжение 12V ({aux?.toFixed(1)} V) — команды отключены.
          </p>
        ) : null}

        {snapshot ? <LiveSnapshotRow snapshot={snapshot} aux={aux} /> : null}

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Окна</h3>
          <ActionGrid
            actions={WINDOW_ACTIONS}
            disabled={disabled}
            pendingId={pendingId}
            onAction={(action) => void runAction(action)}
          />
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Климат</h3>
          <ActionGrid
            actions={CLIMATE_ACTIONS}
            columns={2}
            disabled={disabled}
            pendingId={pendingId}
            onAction={(action) => void runAction(action)}
          />
        </section>

        {sendCommand.isError ? (
          <p className="text-sm text-destructive">
            {sendCommand.error instanceof Error
              ? sendCommand.error.message
              : "Ошибка команды"}
          </p>
        ) : null}

        {commands && commands.length > 0 ? (
          <CommandHistory commands={commands} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusRow({
  snapshot,
  remoteReady,
  aux,
}: {
  snapshot: BydmateLiveSnapshotRow | undefined;
  remoteReady: boolean;
  aux: number | null | undefined;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
          remoteReady
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            : "bg-amber-500/15 text-amber-800 dark:text-amber-400"
        }`}
      >
        {remoteReady ? "Remote ready" : "Remote offline"}
      </span>
      {snapshot && isTelemetryFresh(snapshot) ? (
        <span className="text-xs text-muted-foreground">
          {readSentryProvider(snapshot) === "overdrive"
            ? `Overdrive sentry: ${snapshot.diplus?.sentry_active === true ? "on" : "off"}`
            : `Stall sentry: ${String(snapshot.diplus?.stall_sentry_mode ?? "—")}`}
          {" · "}
          {aux != null ? `${aux.toFixed(1)} V` : "12V —"}
        </span>
      ) : null}
    </div>
  );
}

function LiveSnapshotRow({
  snapshot,
  aux,
}: {
  snapshot: BydmateLiveSnapshotRow;
  aux: number | null | undefined;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground sm:grid-cols-4">
      <span>SOC: {snapshot.diplus?.soc ?? snapshot.telemetry?.soc ?? "—"}%</span>
      <span>12V: {aux != null ? `${aux.toFixed(1)} V` : "—"}</span>
      <span>Скорость: {readSpeed(snapshot)} км/ч</span>
      <span>Передача: {String(readGear(snapshot) ?? "—")}</span>
    </div>
  );
}

function CommandHistory({ commands }: { commands: VehicleCommandRow[] }) {
  return (
    <div className="space-y-1 border-t border-border/60 pt-3">
      <p className="text-xs font-medium text-muted-foreground">История команд</p>
      <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
        {commands.map((cmd) => (
          <li key={cmd.id} className="flex justify-between gap-2">
            <span>
              {cmd.type}
              {cmd.status === "rejected" && cmd.result?.error
                ? ` (${String(cmd.result.error)})`
                : ""}
            </span>
            <span className="text-muted-foreground">{statusLabel(cmd.status)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
