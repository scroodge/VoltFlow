import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDashboardBrowserPreferences,
  serializeDashboardBrowserPreferences,
} from "./dashboard-preferences.ts";

test("round-trips the non-secret dashboard browser preferences", () => {
  const value = serializeDashboardBrowserPreferences({
    selectedCarId: "car-1",
    locale: "be",
  });

  assert.deepEqual(parseDashboardBrowserPreferences(value), {
    selectedCarId: "car-1",
    locale: "be",
  });
});

test("rejects malformed or incomplete preference cookies", () => {
  assert.equal(parseDashboardBrowserPreferences("not-json"), null);
  assert.equal(
    parseDashboardBrowserPreferences(encodeURIComponent(JSON.stringify({ locale: "de" }))),
    null,
  );
});
