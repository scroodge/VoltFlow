import test from "node:test";
import assert from "node:assert/strict";

import { readSohHistoryResponse } from "./soh-history-request.ts";
import { resolveSohPanelState } from "./soh-panel-state.ts";

test("an HTTP 500 reaches the SOH error branch", async () => {
  await assert.rejects(
    readSohHistoryResponse(new Response('{"error":"database timeout"}', { status: 500 })),
    /Failed to load SOH history/,
  );

  assert.equal(
    resolveSohPanelState({ isLoading: false, hasError: true, pointCount: 0 }),
    "error",
  );
});

test("an empty points response reaches only the SOH empty branch", async () => {
  const points = await readSohHistoryResponse(
    new Response('{"points":[]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  const state = resolveSohPanelState({
    isLoading: false,
    hasError: false,
    pointCount: points.length,
  });

  assert.equal(state, "empty");
  assert.notEqual(state, "error");
});

test("SOH panel gives loading precedence", () => {
  assert.equal(
    resolveSohPanelState({ isLoading: true, hasError: true, pointCount: 3 }),
    "loading",
  );
});

test("SOH panel shows one reading without entering the trend state", () => {
  assert.equal(
    resolveSohPanelState({ isLoading: false, hasError: false, pointCount: 1 }),
    "single",
  );
  assert.equal(
    resolveSohPanelState({ isLoading: false, hasError: false, pointCount: 2 }),
    "ready",
  );
});
