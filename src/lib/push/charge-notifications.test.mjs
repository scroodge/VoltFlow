import test from "node:test";
import assert from "node:assert/strict";
import { processVoltflowMateChargeNotifications } from "./charge-notifications.ts";

process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-public-key";
process.env.VAPID_PRIVATE_KEY = "test-private-key";

function createMockSupabase(delayMs = 20) {
  const upsertCalls = [];
  const pushSubscriptionSelects = [];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const client = {
    from(table) {
      if (table === "profiles") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    await sleep(delayMs);
                    return {
                      data: { telegram_id: "123456", notify_channel: "web_push" },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "bydmate_charge_notification_state") {
        return {
          select() {
            return {
              eq() {
                return {
                  async in() {
                    await sleep(delayMs);
                    return { data: [], error: null };
                  },
                };
              },
            };
          },
          async upsert(data, options) {
            await sleep(delayMs);
            upsertCalls.push({ data, options });
            return { error: null };
          },
        };
      }
      if (table === "push_subscriptions") {
        return {
          select() {
            return {
              async eq() {
                await sleep(delayMs);
                pushSubscriptionSelects.push(table);
                return {
                  data: [],
                  error: null,
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { client, upsertCalls, pushSubscriptionSelects };
}

function makeSamples() {
  const vehicles = ["v1", "v2", "v3", "v4", "v5"];
  const samples = [];

  for (const v of vehicles) {
    samples.push({
      vehicle_id: v,
      device_time: "2026-05-25T10:00:00.000Z",
      source: "BYDMate",
      schema_version: 1,
      telemetry: { soc: 20, is_charging: true, charge_power_kw: 7.2 },
    });
    // Crossing 25% and 50%
    samples.push({
      vehicle_id: v,
      device_time: "2026-05-25T10:30:00.000Z",
      source: "BYDMate",
      schema_version: 1,
      telemetry: { soc: 55, is_charging: true, charge_power_kw: 7.2 },
    });
  }

  return { vehicles, samples };
}

test("processVoltflowMateChargeNotifications batches upserts and runs concurrently", async () => {
  const delayMs = 20;
  const { client, upsertCalls, pushSubscriptionSelects } = createMockSupabase(delayMs);
  const { samples } = makeSamples();
  const previousTelemetry = new Map();

  const start = performance.now();
  const result = await processVoltflowMateChargeNotifications({
    supabase: client,
    userId: "user-123",
    samples,
    previousTelemetry,
  });
  const elapsed = performance.now() - start;

  // Expected result thresholds: 10 thresholds total (2 per vehicle * 5 vehicles)
  assert.equal(result.thresholds.length, 10);

  // Verification: Batched upserts result in exactly 1 upsert call instead of 5
  assert.equal(upsertCalls.length, 1);
  assert.equal(Array.isArray(upsertCalls[0].data), true);
  assert.equal(upsertCalls[0].data.length, 5);

  // Verification: Push subscription queries ran (10 calls)
  assert.equal(pushSubscriptionSelects.length, 10);

  console.log(`[Optimized] Duration: ${elapsed.toFixed(2)}ms, Upsert calls count: ${upsertCalls.length}`);
  assert.ok(elapsed < 100, `Expected elapsed time < 100ms, got ${elapsed.toFixed(2)}ms`);
});
