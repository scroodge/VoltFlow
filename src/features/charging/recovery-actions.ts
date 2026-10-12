"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import {
  findTelemetryRecoveryCandidates,
  type TelemetryRecoveryCandidate,
} from "./_domain/telemetry-recovery";
import { insertRecoveredSession } from "./_server/telemetry-recovery-insert";
import type {
  Car,
  ChargingSessionRow,
  VoltflowMateTelemetry,
} from "@/types/database";

const RECOVERY_LOOKBACK_DAYS = 31;
const TELEMETRY_PAGE_SIZE = 1_000;
const MAX_RECOVERY_SAMPLES = 50_000;

const carSchema = z.object({ carId: z.string().uuid() });
const importSchema = carSchema.extend({
  recoveryKey: z.string().min(1).max(160),
});

type CandidateResult =
  | { ok: true; candidates: TelemetryRecoveryCandidate[] }
  | { ok: false; error: string };

async function loadOwnedCar(carId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, car: null };
  const { data: car, error } = await supabase
    .from("cars")
    .select("*")
    .eq("id", carId)
    .eq("user_id", user.id)
    .single();
  return { supabase, user, car: error || !car ? null : (car as Car) };
}

async function candidatesForOwnedCar(
  carId: string,
): Promise<
  | { error: string }
  | {
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string;
      car: Car;
      candidates: TelemetryRecoveryCandidate[];
    }
> {
  const owned = await loadOwnedCar(carId);
  if (!owned.user) return { error: "Unauthorized" };
  if (!owned.car?.vehicle_alias?.trim())
    return { error: "Vehicle is not linked" };

  const from = new Date(
    Date.now() - RECOVERY_LOOKBACK_DAYS * 86_400_000,
  ).toISOString();
  const telemetry: { device_time: string; telemetry: VoltflowMateTelemetry }[] =
    [];
  for (
    let offset = 0;
    offset < MAX_RECOVERY_SAMPLES;
    offset += TELEMETRY_PAGE_SIZE
  ) {
    const { data, error } = await owned.supabase
      .from("bydmate_telemetry_samples")
      .select("device_time,telemetry")
      .eq("user_id", owned.user.id)
      .eq("vehicle_id", owned.car.vehicle_alias.trim())
      .gte("device_time", from)
      .order("device_time", { ascending: true })
      .range(offset, offset + TELEMETRY_PAGE_SIZE - 1);
    if (error) return { error: error.message };
    telemetry.push(
      ...((data ?? []) as {
        device_time: string;
        telemetry: VoltflowMateTelemetry;
      }[]),
    );
    if (!data || data.length < TELEMETRY_PAGE_SIZE) break;
  }
  if (telemetry.length >= MAX_RECOVERY_SAMPLES) {
    return { error: "Too much retained telemetry to recover safely" };
  }

  const detected = findTelemetryRecoveryCandidates(owned.car, telemetry);
  const { data: sessions, error: sessionsError } = await owned.supabase
    .from("charging_sessions")
    .select("started_at,stopped_at,recovery_key")
    .eq("user_id", owned.user.id)
    .eq("car_id", owned.car.id)
    .gte("stopped_at", from);
  if (sessionsError) return { error: sessionsError.message };
  const existing = (sessions ?? []) as Pick<
    ChargingSessionRow,
    "started_at" | "stopped_at" | "recovery_key"
  >[];
  const candidates = detected.filter(
    (candidate) =>
      !existing.some(
        (session) =>
          session.recovery_key === candidate.key ||
          (session.started_at != null &&
            session.stopped_at != null &&
            session.started_at <= candidate.stoppedAt &&
            session.stopped_at >= candidate.startedAt),
      ),
  );
  return {
    supabase: owned.supabase,
    userId: owned.user.id,
    car: owned.car,
    candidates,
  };
}

export async function listTelemetryRecoveryCandidates(
  input: z.infer<typeof carSchema>,
): Promise<CandidateResult> {
  const parsed = carSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid vehicle" };
  const result = await candidatesForOwnedCar(parsed.data.carId);
  if ("error" in result) return { ok: false, error: result.error };
  return { ok: true, candidates: result.candidates };
}

export async function importTelemetryRecoveryCandidate(
  input: z.infer<typeof importSchema>,
): Promise<
  | { ok: true; sessionId: string }
  | { ok: false; error: string; code?: "missing" | "overlap" | "duplicate" }
> {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Invalid recovery candidate" };
  const result = await candidatesForOwnedCar(parsed.data.carId);
  if ("error" in result) return { ok: false, error: result.error };
  const candidate = result.candidates.find(
    (item) => item.key === parsed.data.recoveryKey,
  );
  if (!candidate)
    return {
      ok: false,
      error: "Recovery candidate is no longer available",
      code: "missing",
    };

  const inserted = await insertRecoveredSession(result.supabase, {
    userId: result.userId,
    car: result.car,
    candidate,
  });
  if (!inserted.ok) return inserted;

  revalidatePath("/dashboard");
  revalidatePath("/history");
  return { ok: true, sessionId: inserted.sessionId };
}
