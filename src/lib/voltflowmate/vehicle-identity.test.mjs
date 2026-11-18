import assert from "node:assert/strict";
import test from "node:test";

import { parseVehicleUid, resolveVehicleKey } from "./vehicle-identity.ts";

const UID = "3F2B8C1E-4D5A-4B6C-9D7E-0A1B2C3D4E5F";

function fakeRpc(result) {
  const calls = [];
  return {
    calls,
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return result;
    },
  };
}

test("older APK without a uid keeps the header name and costs no query", async () => {
  const supabase = fakeRpc({ data: "unused", error: null });
  assert.equal(await resolveVehicleKey(supabase, "user-1", "way", null), "way");
  assert.equal(supabase.calls.length, 0);
});

test("a malformed uid is treated like an older APK", async () => {
  const supabase = fakeRpc({ data: "unused", error: null });
  assert.equal(await resolveVehicleKey(supabase, "user-1", "way", "x"), "way");
  assert.equal(supabase.calls.length, 0);
});

test("a renamed car is stored under the key its uid was bound to", async () => {
  const supabase = fakeRpc({ data: "way", error: null });
  assert.equal(await resolveVehicleKey(supabase, "user-1", "Way renamed", UID), "way");
  assert.deepEqual(supabase.calls, [
    {
      fn: "bydmate_resolve_vehicle_key",
      args: { p_user_id: "user-1", p_vehicle_uid: UID.toLowerCase(), p_name: "Way renamed" },
    },
  ]);
});

test("a failed lookup falls back to the header name instead of dropping data", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const supabase = fakeRpc({ data: null, error: { message: "boom" } });
    assert.equal(await resolveVehicleKey(supabase, "user-1", "way", UID), "way");
  } finally {
    console.error = original;
  }
});

test("parseVehicleUid returns null for null, undefined, empty, or whitespace-only inputs", () => {
  assert.equal(parseVehicleUid(null), null);
  assert.equal(parseVehicleUid(undefined), null);
  assert.equal(parseVehicleUid(""), null);
  assert.equal(parseVehicleUid("   "), null);
});

test("parseVehicleUid normalises case and trims valid vehicle identifiers", () => {
  assert.equal(parseVehicleUid("  BYD_123456  "), "byd_123456");
  assert.equal(parseVehicleUid(`  ${UID} `), UID.toLowerCase());
  assert.equal(parseVehicleUid("abc"), "abc");
});

test("parseVehicleUid returns null for strings shorter than 3 or longer than 64 characters", () => {
  assert.equal(parseVehicleUid("ab"), null);
  assert.equal(parseVehicleUid("a".repeat(65)), null);
  assert.equal(parseVehicleUid("a".repeat(64)), "a".repeat(64));
});

test("parseVehicleUid returns null for strings containing invalid characters", () => {
  assert.equal(parseVehicleUid("byd 123456"), null);
  assert.equal(parseVehicleUid("byd@123456"), null);
  assert.equal(parseVehicleUid("byd!123456"), null);
  assert.equal(parseVehicleUid("byd/123456"), null);
});
