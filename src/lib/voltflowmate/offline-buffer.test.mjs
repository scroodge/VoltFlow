import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OFFLINE_BUFFER_CAP_BYTES,
  offlineBufferGrantField,
} from "./offline-buffer.ts";

test("grants the client's maximum 4 GiB ceiling", () => {
  assert.equal(OFFLINE_BUFFER_CAP_BYTES, 4 * 1024 ** 3);
});

test("grant field uses the wire name the client parses", () => {
  assert.deepEqual(offlineBufferGrantField(), {
    offline_buffer_cap_bytes: OFFLINE_BUFFER_CAP_BYTES,
  });
});

test("static commands-disabled response carries the same grant", () => {
  // With remote commands off, next.config.ts rewrites /api/bydmate/commands to this file and
  // the route handler never runs — so the grant must be baked into the file itself.
  const body = JSON.parse(
    readFileSync(
      new URL("../../../public/bydmate-commands-disabled.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(body.offline_buffer_cap_bytes, OFFLINE_BUFFER_CAP_BYTES);
});

test("grant is a positive integer — the client treats 0 as 'not granted'", () => {
  assert.ok(Number.isInteger(OFFLINE_BUFFER_CAP_BYTES));
  assert.ok(OFFLINE_BUFFER_CAP_BYTES > 0);
});
