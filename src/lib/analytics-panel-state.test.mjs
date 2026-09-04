import test from "node:test";
import assert from "node:assert/strict";

import { resolveAnalyticsPanelState } from "./analytics-panel-state.ts";
import { shouldEnableDeferredAnalyticsQuery } from "./analytics-query-scheduling.ts";
import { readAnalyticsResponse } from "./analytics-request.ts";
import { isMissingDatabaseFunction } from "./database-function-compatibility.ts";
import { resolveCompletePeriodOverview } from "./period-overview.ts";

const timeoutError = {
  code: "57014",
  message: "canceling statement due to statement timeout",
};

function errorState() {
  return resolveAnalyticsPanelState({ isLoading: false, hasError: true, itemCount: 0 });
}

function emptyState() {
  return resolveAnalyticsPanelState({ isLoading: false, hasError: false, itemCount: 0 });
}

test("phantom drain: HTTP 500 reaches error and empty data reaches only empty", async () => {
  await assert.rejects(
    readAnalyticsResponse(new Response('{"error":"database error"}', { status: 500 })),
    /Failed to load analytics/,
  );
  assert.equal(errorState(), "error");

  const payload = await readAnalyticsResponse(
    new Response('{"rows":[]}', { status: 200, headers: { "content-type": "application/json" } }),
  );
  const state = resolveAnalyticsPanelState({
    isLoading: false,
    hasError: false,
    itemCount: payload.rows.length,
  });
  assert.equal(state, "empty");
  assert.notEqual(state, "error");
});

test("phantom drain: database timeout is not absorbed by the compatibility fallback", () => {
  assert.equal(
    isMissingDatabaseFunction(timeoutError, "bydmate_phantom_drain_daily"),
    false,
  );
  assert.equal(errorState(), "error");
});

test("route insights: HTTP 500 reaches error and empty data reaches only empty", async () => {
  await assert.rejects(
    readAnalyticsResponse(new Response('{"error":"database error"}', { status: 500 })),
    /Failed to load analytics/,
  );
  assert.equal(errorState(), "error");

  const payload = await readAnalyticsResponse(
    new Response('{"routes":[],"parkedRoutes":[]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  const state = resolveAnalyticsPanelState({
    isLoading: false,
    hasError: false,
    itemCount: payload.routes.length + payload.parkedRoutes.length,
  });
  assert.equal(state, "empty");
  assert.notEqual(state, "error");
});

test("route insights: database timeout is not absorbed by the compatibility fallback", () => {
  assert.equal(
    isMissingDatabaseFunction(timeoutError, "bydmate_route_insight_inputs"),
    false,
  );
  assert.equal(errorState(), "error");
});

test("period overview: HTTP 500 reaches error and empty data reaches only empty", async () => {
  await assert.rejects(
    readAnalyticsResponse(new Response('{"error":"database error"}', { status: 500 })),
    /Failed to load analytics/,
  );
  assert.equal(errorState(), "error");

  const payload = await readAnalyticsResponse(
    new Response('{"trips":[],"sessions":[]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  const state = resolveAnalyticsPanelState({
    isLoading: false,
    hasError: false,
    itemCount: payload.trips.length + payload.sessions.length,
  });
  assert.equal(state, "empty");
  assert.notEqual(state, "error");
});

test("period overview: one database timeout rejects the complete response", async () => {
  await assert.rejects(
    resolveCompletePeriodOverview({
      trips: Promise.resolve([]),
      sessions: Promise.reject(timeoutError),
      estimatedNoChargeDayPricePerKwh: Promise.resolve(null),
    }),
    timeoutError,
  );
  assert.equal(errorState(), "error");
});

test("only missing-function errors enable compatibility fallbacks", () => {
  assert.equal(
    isMissingDatabaseFunction(
      { code: "PGRST202", message: "Could not find public.bydmate_phantom_drain_daily" },
      "bydmate_phantom_drain_daily",
    ),
    true,
  );
  assert.equal(emptyState(), "empty");
});

test("noncritical analytics wait until critical data settles or their section approaches", () => {
  assert.equal(
    shouldEnableDeferredAnalyticsQuery({ criticalQueriesSettled: false, nearViewport: false }),
    false,
  );
  assert.equal(
    shouldEnableDeferredAnalyticsQuery({ criticalQueriesSettled: true, nearViewport: false }),
    true,
  );
  assert.equal(
    shouldEnableDeferredAnalyticsQuery({ criticalQueriesSettled: false, nearViewport: true }),
    true,
  );
});
