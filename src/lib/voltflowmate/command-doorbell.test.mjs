import assert from "node:assert/strict";
import test from "node:test";

import { realtimeWebsocketUrl, wantsDoorbell } from "./command-doorbell.ts";

test("realtime websocket url is derived from the Supabase project url", () => {
  assert.equal(
    realtimeWebsocketUrl("https://abc.supabase.co"),
    "wss://abc.supabase.co/realtime/v1/websocket",
  );
  assert.equal(
    realtimeWebsocketUrl("http://127.0.0.1:54321/"),
    "ws://127.0.0.1:54321/realtime/v1/websocket",
  );
  assert.equal(realtimeWebsocketUrl(undefined), null);
  assert.equal(realtimeWebsocketUrl("not a url"), null);
});

test("only Mate builds that send X-Doorbell: 1 get a doorbell", () => {
  assert.equal(wantsDoorbell(new Request("https://x", { headers: { "X-Doorbell": "1" } })), true);
  assert.equal(wantsDoorbell(new Request("https://x")), false);
});
