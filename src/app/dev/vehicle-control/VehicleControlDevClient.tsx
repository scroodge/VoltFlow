"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { VehicleControlPanel } from "@/components/vehicle/vehicle-control-panel";
import { useVehicleCommandsQuery } from "@/hooks/use-vehicle-commands-query";

type AgentCommand = {
  id: string;
  type: string;
  params: Record<string, unknown>;
};

type VehicleControlDevClientProps = {
  vehicleId: string;
  apiKey: string | null;
  telemetryEndpoint: string;
};

export function VehicleControlDevClient({
  vehicleId,
  apiKey,
  telemetryEndpoint,
}: VehicleControlDevClientProps) {
  const { data: commands, refetch } = useVehicleCommandsQuery(vehicleId, { enabled: true });
  const [agentLog, setAgentLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const commandsPollUrl = telemetryEndpoint.replace(/\/telemetry\/?$/, "/commands");
  const commandsAckUrl = `${commandsPollUrl}/ack`;

  function log(line: string) {
    setAgentLog((prev) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev].slice(0, 30));
  }

  async function pollAsAgent(dryRun: boolean) {
    if (!apiKey) {
      log("No bydmate_cloud_api_key on dev profile");
      return;
    }

    setBusy(true);
    try {
      const pollResponse = await fetch(commandsPollUrl, {
        headers: {
          "X-API-Key": apiKey,
          "X-Vehicle-Id": vehicleId,
          "X-App": "VoltFlow-Mate-Dev",
        },
        cache: "no-store",
      });
      const pollPayload = (await pollResponse.json()) as {
        ok?: boolean;
        commands?: AgentCommand[];
        error?: string;
      };

      if (!pollResponse.ok || !pollPayload.ok) {
        log(`Poll failed: ${pollPayload.error ?? pollResponse.status}`);
        return;
      }

      const batch = pollPayload.commands ?? [];
      log(`Poll OK — ${batch.length} command(s)`);
      if (batch.length === 0) return;

      for (const cmd of batch) {
        log(`  → ${cmd.type} ${JSON.stringify(cmd.params)}`);
      }

      if (dryRun) {
        log("Dry run — not acking (commands stay sent)");
        await refetch();
        return;
      }

      const acks = batch.map((cmd) => ({
        id: cmd.id,
        status: "done",
        result: { phrase: `[dev-sim] ${cmd.type}`, verified: false, simulated: true },
      }));

      const ackResponse = await fetch(commandsAckUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "X-Vehicle-Id": vehicleId,
          "X-App": "VoltFlow-Mate-Dev",
        },
        body: JSON.stringify({ acks }),
      });
      const ackPayload = (await ackResponse.json()) as { ok?: boolean; updated?: number; error?: string };
      if (!ackResponse.ok || !ackPayload.ok) {
        log(`Ack failed: ${ackPayload.error ?? ackResponse.status}`);
      } else {
        log(`Acked ${ackPayload.updated ?? 0} command(s) as done (simulated)`);
      }
      await refetch();
    } catch (error) {
      log(error instanceof Error ? error.message : "Agent poll error");
    } finally {
      setBusy(false);
    }
  }

  async function rejectSent() {
    if (!apiKey) return;
    const sent = (commands ?? []).filter((row) => row.status === "sent");
    if (sent.length === 0) {
      log("No sent commands to reject");
      return;
    }

    setBusy(true);
    try {
      const acks = sent.map((row) => ({
        id: row.id,
        status: "rejected",
        result: { error: "dev_cleanup", simulated: true },
      }));
      const ackResponse = await fetch(commandsAckUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "X-Vehicle-Id": vehicleId,
        },
        body: JSON.stringify({ acks }),
      });
      const payload = (await ackResponse.json()) as { ok?: boolean; updated?: number };
      log(payload.ok ? `Rejected ${payload.updated ?? 0} sent row(s)` : "Reject failed");
      await refetch();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
          Dev / Vehicle control
        </p>
        <h1 className="font-heading text-2xl font-bold">Remote commands (way)</h1>
        <p className="text-sm text-muted-foreground">
          Queue commands without login. Use agent simulator to test poll/ack without the APK or
          car. Real D+ execution still requires BYDMate on the head unit or{" "}
          <code className="text-xs">agent_dev.py</code>.
        </p>
      </header>

      <VehicleControlPanel vehicleId={vehicleId} relaxGuards defaultExpanded />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Agent simulator</CardTitle>
          <CardDescription>
            Calls the same endpoints as BYDMate: <code className="text-xs">{commandsPollUrl}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!apiKey ? (
            <p className="text-sm text-amber-600">
              Profile has no <code>bydmate_cloud_api_key</code> — generate one in Settings or link
              BYDMate first.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !apiKey} onClick={() => void pollAsAgent(true)}>
              Poll (dry run)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !apiKey}
              onClick={() => void pollAsAgent(false)}
            >
              Poll + ack simulated
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !apiKey}
              onClick={() => void rejectSent()}
            >
              Reject sent (cleanup)
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refetch()}>
              Refresh list
            </Button>
          </div>
          {agentLog.length > 0 ? (
            <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
              {agentLog.join("\n")}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Also try</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <a className="text-primary underline" href="/dev/vehicle">
              /dev/vehicle
            </a>{" "}
            — full vehicle page with control panel (live guards on).
          </p>
          <p>
            Curl poll:{" "}
            <code className="block break-all text-xs">
              curl -s -H &quot;X-API-Key: …&quot; -H &quot;X-Vehicle-Id: {vehicleId}&quot;{" "}
              {commandsPollUrl}
            </code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
