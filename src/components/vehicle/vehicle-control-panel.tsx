"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import {
  useSendVehicleCommand,
  useVehicleCommandsQuery,
} from "@/hooks/use-vehicle-commands-query";
import type { BydmateLiveSnapshotRow, VehicleCommandRow } from "@/types/database";

const STALE_MS = 90_000;
const LOW_AUX_V = 11.8;
function gearIsPark(gear: unknown) {
  if (gear === 1 || gear === "1" || gear === "P") return true;
  return false;
}

function readSpeed(snapshot: BydmateLiveSnapshotRow | undefined) {
  const fromDiplus = snapshot?.diplus?.speed_kmh;
  const fromTelemetry = snapshot?.telemetry?.speed_kmh;
  return Number(fromDiplus ?? fromTelemetry ?? 0);
}

function readGear(snapshot: BydmateLiveSnapshotRow | undefined) {
  return snapshot?.diplus?.gear ?? null;
}

function readAuxVoltage(snapshot: BydmateLiveSnapshotRow | undefined) {
  return (
    snapshot?.diplus?.voltage_12v ??
    snapshot?.telemetry?.aux_voltage_v ??
    null
  );
}

function isControlAllowed(snapshot: BydmateLiveSnapshotRow | undefined) {
  if (!snapshot) return false;
  const receivedAt = new Date(snapshot.received_at).getTime();
  if (Number.isNaN(receivedAt) || Date.now() - receivedAt > STALE_MS) return false;
  if (readSpeed(snapshot) > 0) return false;
  if (!gearIsPark(readGear(snapshot))) return false;
  const aux = readAuxVoltage(snapshot);
  if (aux != null && aux > 0 && aux < LOW_AUX_V) return false;
  return true;
}

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

type VehicleControlPanelProps = {
  vehicleId: string | null;
  /** Dev only: allow enqueue without fresh parked live snapshot. */
  relaxGuards?: boolean;
};

export function VehicleControlPanel({ vehicleId, relaxGuards = false }: VehicleControlPanelProps) {
  const { data: liveRows } = useBydmateLiveQuery();
  const { data: commands } = useVehicleCommandsQuery(vehicleId);
  const sendCommand = useSendVehicleCommand(vehicleId);
  const [socLimit, setSocLimit] = useState("80");
  const [windowPct, setWindowPct] = useState("10");

  const snapshot = useMemo(() => {
    if (!vehicleId) return undefined;
    return liveRows?.find((row) => row.vehicle_id === vehicleId);
  }, [liveRows, vehicleId]);

  const allowed = relaxGuards || isControlAllowed(snapshot);
  const stale =
    !relaxGuards &&
    snapshot != null &&
    Date.now() - new Date(snapshot.received_at).getTime() > STALE_MS;
  const aux = readAuxVoltage(snapshot);
  const lowAux =
    !relaxGuards && aux != null && aux > 0 && aux < LOW_AUX_V;

  const disabled = !vehicleId || !allowed || sendCommand.isPending;

  async function run(type: string, params: Record<string, unknown> = {}) {
    await sendCommand.mutateAsync({ type, params });
  }

  async function runUnlock() {
    if (!window.confirm("Разблокировать автомобиль?")) return;
    await run("unlock");
  }

  if (!vehicleId) return null;

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Удалённое управление</CardTitle>
        <CardDescription>
          Только на стоянке (P, 0 км/ч). Команды через BYDMate → D+.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {stale ? (
          <p className="text-sm text-amber-600">Нет свежих данных с машины (&gt;90 с).</p>
        ) : null}
        {lowAux ? (
          <p className="text-sm text-amber-600">
            Низкое напряжение 12V ({aux?.toFixed(1)} V) — команды отключены.
          </p>
        ) : null}
        {snapshot ? (
          <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground sm:grid-cols-4">
            <span>SOC: {snapshot.diplus?.soc ?? snapshot.telemetry?.soc ?? "—"}%</span>
            <span>12V: {aux != null ? `${aux.toFixed(1)} V` : "—"}</span>
            <span>Скорость: {readSpeed(snapshot)} км/ч</span>
            <span>Передача: {String(readGear(snapshot) ?? "—")}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={disabled} onClick={() => void run("lock")}>
            Заблокировать
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => void runUnlock()}>
            Разблокировать
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => void run("hud", { on: true })}
          >
            HUD вкл
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => void run("hud", { on: false })}
          >
            HUD выкл
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="soc-limit">
              Лимит SOC %
            </label>
            <Input
              id="soc-limit"
              className="h-8 w-20"
              type="number"
              min={50}
              max={100}
              value={socLimit}
              onChange={(e) => setSocLimit(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => void run("set_soc_limit", { value: Number(socLimit) })}
          >
            Установить SOC
          </Button>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="window-pct">
              Окно %
            </label>
            <Input
              id="window-pct"
              className="h-8 w-20"
              type="number"
              min={0}
              max={100}
              value={windowPct}
              onChange={(e) => setWindowPct(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={disabled}
            onClick={() =>
              void run("window", { which: "driver", pct: Number(windowPct) })
            }
          >
            Окно водителя
          </Button>
        </div>

        {sendCommand.isError ? (
          <p className="text-sm text-destructive">
            {sendCommand.error instanceof Error
              ? sendCommand.error.message
              : "Ошибка команды"}
          </p>
        ) : null}

        {commands && commands.length > 0 ? (
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
        ) : null}
      </CardContent>
    </Card>
  );
}
