import assert from "node:assert/strict";
import test from "node:test";

import { isCommandStandby } from "./remote-commands.ts";

test("only an explicit X-Command-Standby: 1 makes a poll claim nothing", () => {
  assert.equal(isCommandStandby(new Request("https://x", { headers: { "X-Command-Standby": "1" } })), true);
  assert.equal(isCommandStandby(new Request("https://x", { headers: { "X-Command-Standby": "0" } })), false);
  assert.equal(isCommandStandby(new Request("https://x")), false);
});
