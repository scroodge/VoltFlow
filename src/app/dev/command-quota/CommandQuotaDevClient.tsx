"use client";

import { CommandErrorNotice } from "@/components/vehicle/command-quota-notice";
import { VehicleCommandError } from "@/hooks/use-vehicle-commands-query";
import { quotaBlock, quotaMessage } from "@/lib/vehicle/command-quota";

/**
 * Renders the notice exactly as the API would trigger it: the message comes from the same
 * quotaBlock/quotaMessage the POST route uses, for a free user one minute after a command
 * and two hours after a snapshot.
 */
function noticeFor(type: string, agoMs: number) {
  const now = Date.now();
  const block = quotaBlock(
    "free",
    type,
    [
      {
        created_at: new Date(now - agoMs).toISOString(),
        status: "done",
        result: null,
      },
    ],
    now,
  );
  if (!block) return null;
  return new VehicleCommandError(
    quotaMessage(block),
    "plan_quota",
    block.retryAfterSeconds,
  );
}

export function CommandQuotaDevClient() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs font-semibold tracking-widest text-primary">
          DEV / COMMAND QUOTA
        </p>
        <h1 className="text-2xl font-bold">Лимиты команд</h1>
      </header>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          Команда (1 в 5 минут, последняя минуту назад)
        </h2>
        <CommandErrorNotice error={noticeFor("fan_speed_step", 60_000)} />
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          Снимок с камер (1 в 8 часов, последний 2 ч назад)
        </h2>
        <CommandErrorNotice
          error={noticeFor("camera_snapshot", 2 * 3_600_000)}
        />
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Обычная ошибка (не лимит)</h2>
        <CommandErrorNotice error={new Error("Insert failed")} />
      </section>
    </div>
  );
}
