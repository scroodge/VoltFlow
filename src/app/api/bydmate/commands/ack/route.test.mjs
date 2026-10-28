import assert from "node:assert/strict";
import test, { mock } from "node:test";

import * as serviceModule from "../../../../../lib/supabase/service.ts";
import * as authModule from "../../../../../lib/voltflowmate/api-auth.ts";
import * as identityModule from "../../../../../lib/voltflowmate/vehicle-identity.ts";

import { POST } from "./route.ts";

test("ACK endpoint sequential vs concurrent performance comparison", async () => {
  const mockSupabase = {
    from: (table) => {
      assert.equal(table, "vehicle_commands");
      return {
        update: (updatePayload) => {
          return {
            eq: (field1, val1) => ({
              eq: (field2, val2) => ({
                in: (field3, val3) => {
                  // Simulate 50ms network latency per database query
                  return new Promise((resolve) => {
                    setTimeout(() => resolve({ error: null }), 50);
                  });
                },
              }),
            }),
          };
        },
      };
    },
  };

  mock.method(serviceModule, "createServiceClient", () => mockSupabase);
  mock.method(authModule, "resolveVoltflowMateApiKeyProfile", async () => ({
    id: "user-123",
  }));
  mock.method(identityModule, "resolveVehicleKey", async () => "vehicle-456");

  const body = {
    acks: Array.from({ length: 10 }, (_, i) => ({
      id: `cmd-${i}`,
      status: i % 2 === 0 ? "done" : "failed",
      result: { detail: `res-${i}` },
    })),
  };

  const req = new Request("http://localhost/api/bydmate/commands/ack", {
    method: "POST",
    headers: {
      "x-api-key": "test-key",
      "x-vehicle-id": "vehicle-456",
      "content-length": JSON.stringify(body).length.toString(),
    },
    body: JSON.stringify(body),
  });

  const startTime = Date.now();
  const res = await POST(req);
  const duration = Date.now() - startTime;

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.updated, 10);

  // 10 sequential items with 50ms delay each would take > 500ms.
  // With Promise.all concurrent updates, it takes ~50-100ms.
  assert.ok(duration < 250, `Expected duration < 250ms, got ${duration}ms`);
  console.log(`[BENCHMARK] Concurrent ACK processing duration for 10 items: ${duration}ms`);
});
