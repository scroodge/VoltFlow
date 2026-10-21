import test from "node:test";
import assert from "node:assert/strict";

import {
  isTelegramLiveWidgetBacklogSample,
  isTelegramLiveWidgetEditDue,
} from "./live-widget-edit-due.ts";

const NOW = Date.parse("2026-10-08T04:42:46Z");
const EDITED_18S_AGO = new Date(NOW - 18_000).toISOString();
const EDITED_31S_AGO = new Date(NOW - 31_000).toISOString();

function row(overrides = {}) {
  return {
    status: "active",
    updated_at: EDITED_18S_AGO,
    last_state: "driving",
    ...overrides,
  };
}

test("no row or a non-active row is always due", () => {
  assert.equal(isTelegramLiveWidgetEditDue(null, NOW, "parked"), true);
  assert.equal(
    isTelegramLiveWidgetEditDue(row({ status: "offline" }), NOW, "driving"),
    true,
  );
});

test("same state inside the throttle window is skipped", () => {
  assert.equal(isTelegramLiveWidgetEditDue(row(), NOW, "driving"), false);
});

test("same state after the throttle window is due", () => {
  assert.equal(
    isTelegramLiveWidgetEditDue(row({ updated_at: EDITED_31S_AGO }), NOW, "driving"),
    true,
  );
});

test("a state change bypasses the throttle (driving → parked 18 s later)", () => {
  assert.equal(isTelegramLiveWidgetEditDue(row(), NOW, "parked"), true);
});

test("an unknown last_state keeps the plain throttle", () => {
  assert.equal(
    isTelegramLiveWidgetEditDue(row({ last_state: null }), NOW, "parked"),
    false,
  );
});

test("a replayed offline batch is backlog, a live one is not (car cl, 2026-10-21)", () => {
  const flushedAt = Date.parse("2026-10-21T09:46:57.850Z");
  // Newest sample of the 12:46:57 flush was 11:46:41 local (charging 90.8 %).
  assert.equal(
    isTelegramLiveWidgetBacklogSample("2026-10-21T08:46:41Z", flushedAt),
    true,
  );
  // The daemon's live sample arrives ~3 s after its device time.
  assert.equal(
    isTelegramLiveWidgetBacklogSample("2026-10-21T09:46:54Z", flushedAt),
    false,
  );
});

test("an unparseable device time is not treated as backlog", () => {
  assert.equal(isTelegramLiveWidgetBacklogSample("", NOW), false);
});
