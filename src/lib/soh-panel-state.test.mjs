import test from "node:test";
import assert from "node:assert/strict";

import { resolveSohPanelState } from "./soh-panel-state.ts";

test("SOH panel distinguishes failed requests from successful empty history", () => {
  assert.equal(
    resolveSohPanelState({ isLoading: false, hasError: true, pointCount: 0 }),
    "error",
  );
  assert.equal(
    resolveSohPanelState({ isLoading: false, hasError: false, pointCount: 0 }),
    "empty",
  );
});

test("SOH panel gives loading precedence and renders populated history", () => {
  assert.equal(
    resolveSohPanelState({ isLoading: true, hasError: true, pointCount: 3 }),
    "loading",
  );
  assert.equal(
    resolveSohPanelState({ isLoading: false, hasError: false, pointCount: 3 }),
    "ready",
  );
});
