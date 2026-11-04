import type {
  VehicleCommandRow,
  VoltflowMateLiveSnapshotRow,
} from "@/types/database";

/**
 * What the climate buttons show: the live snapshot's di+ values, overridden by the `after`
 * value of any newer acked command (Mate 0.6.5+ reads the di+ value before and after each
 * climate command and puts it in `result.state`). The ack lands within ~1 s of the press; the
 * next snapshot may take several more, so without the override the button would lag.
 */
export type ClimateField = "ac_status" | "ac_temp_c" | "fan_level" | "ac_circ";
export type ClimateState = Record<ClimateField, number | null>;

/** `空调循环方式` per mode, as measured on the car. Null = not measured: no highlight. */
export const CIRCULATION_VALUES: {
  internal: number | null;
  external: number | null;
} = {
  internal: null,
  external: null,
};

export const CLIMATE_COMMAND_TYPES = [
  "ac",
  "ac_temp_step",
  "fan_speed_step",
  "ac_recirculation",
] as const;

const FIELDS: ClimateField[] = [
  "ac_status",
  "ac_temp_c",
  "fan_level",
  "ac_circ",
];

function toNumber(value: unknown): number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type CommandState = { field?: unknown; after?: unknown };

function stateOf(
  command: VehicleCommandRow,
): { field: ClimateField; after: number } | null {
  const state = command.result?.state as CommandState | undefined;
  const field = state?.field;
  const after = toNumber(state?.after);
  if (
    typeof field !== "string" ||
    !FIELDS.includes(field as ClimateField) ||
    after == null
  ) {
    return null;
  }
  return { field: field as ClimateField, after };
}

export function readClimateState(
  snapshot: VoltflowMateLiveSnapshotRow | undefined,
  commands: readonly VehicleCommandRow[] | undefined,
): ClimateState {
  const diplus = (snapshot?.diplus ?? {}) as Record<string, unknown>;
  const state: ClimateState = {
    ac_status: toNumber(diplus.ac_status),
    ac_temp_c: toNumber(diplus.ac_temp_c),
    fan_level: toNumber(diplus.fan_level),
    ac_circ: toNumber(diplus.ac_circ),
  };
  const snapshotAt = snapshot ? new Date(snapshot.received_at).getTime() : 0;
  const overridden = new Set<ClimateField>();
  const newestFirst = [...(commands ?? [])].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  for (const command of newestFirst) {
    if (command.status !== "done" || !command.executed_at) continue;
    const acked = stateOf(command);
    if (!acked || overridden.has(acked.field)) continue;
    overridden.add(acked.field);
    if (new Date(command.executed_at).getTime() > snapshotAt) {
      state[acked.field] = acked.after;
    }
  }
  return state;
}

/** Climate commands still waiting for the car (their button shows a spinner). */
export function climateCommandsInFlight(
  commands: readonly VehicleCommandRow[] | undefined,
): VehicleCommandRow[] {
  return (commands ?? []).filter(
    (command) =>
      (command.status === "pending" || command.status === "sent") &&
      (CLIMATE_COMMAND_TYPES as readonly string[]).includes(command.type),
  );
}

/**
 * The newest climate command, when di+ accepted it but the watched value never moved —
 * the car "did not react". Only recent ones: an old warning is noise.
 */
export function unconfirmedClimateCommand(
  commands: readonly VehicleCommandRow[] | undefined,
  nowMs: number,
  windowMs = 2 * 60 * 1000,
): VehicleCommandRow | null {
  const newest = [...(commands ?? [])]
    .filter((command) =>
      (CLIMATE_COMMAND_TYPES as readonly string[]).includes(command.type),
    )
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];
  if (!newest || newest.status !== "done") return null;
  if (nowMs - new Date(newest.created_at).getTime() > windowMs) return null;
  if (!stateOf(newest) || newest.result?.verified !== false) return null;
  return newest;
}
