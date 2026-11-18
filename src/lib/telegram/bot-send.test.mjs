import assert from "node:assert/strict";
import test from "node:test";

import {
  answerTelegramCallback,
  deleteTelegramMessage,
  editTelegramMessageText,
  sendTelegramDocument,
  sendTelegramLocation,
  sendTelegramMessage,
} from "./bot-send.ts";

const ORIGINAL_ENV_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ORIGINAL_FETCH = globalThis.fetch;

function setupMockFetch(handler) {
  globalThis.fetch = async (url, init) => {
    return handler(url, init);
  };
}

function restoreGlobals() {
  process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_ENV_TOKEN;
  globalThis.fetch = ORIGINAL_FETCH;
}

test("sendTelegramLocation - returns missing_bot_token when TELEGRAM_BOT_TOKEN is not set", async (t) => {
  t.after(restoreGlobals);
  delete process.env.TELEGRAM_BOT_TOKEN;

  const result = await sendTelegramLocation("12345", 53.9, 27.56);
  assert.deepEqual(result, { ok: false, error: "missing_bot_token" });
});

test("sendTelegramLocation - sends correct request payload and handles success", async (t) => {
  t.after(restoreGlobals);
  process.env.TELEGRAM_BOT_TOKEN = "test_token_123";

  let capturedUrl = "";
  let capturedInit = null;

  setupMockFetch(async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true, result: { message_id: 101 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const result = await sendTelegramLocation("123456789", 53.9045, 27.5615);

  assert.deepEqual(result, { ok: true });
  assert.equal(capturedUrl, "https://api.telegram.org/bottest_token_123/sendLocation");
  assert.equal(capturedInit.method, "POST");
  assert.equal(capturedInit.headers["content-type"], "application/json");

  const body = JSON.parse(capturedInit.body);
  assert.deepEqual(body, {
    chat_id: "123456789",
    latitude: 53.9045,
    longitude: 27.5615,
  });
});

test("sendTelegramLocation - handles numeric chatId", async (t) => {
  t.after(restoreGlobals);
  process.env.TELEGRAM_BOT_TOKEN = "test_token_123";

  let capturedBody = null;
  setupMockFetch(async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  const result = await sendTelegramLocation(987654321, 10.0, 20.0);
  assert.deepEqual(result, { ok: true });
  assert.equal(capturedBody.chat_id, 987654321);
});

test("sendTelegramLocation - handles 403 blocked error response", async (t) => {
  t.after(restoreGlobals);
  process.env.TELEGRAM_BOT_TOKEN = "test_token_123";

  setupMockFetch(async () => {
    return new Response(
      JSON.stringify({
        ok: false,
        error_code: 403,
        description: "Forbidden: bot was blocked by the user",
      }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  });

  const result = await sendTelegramLocation("12345", 53.9, 27.56);
  assert.deepEqual(result, {
    ok: false,
    error: "Forbidden: bot was blocked by the user",
    blocked: true,
  });
});

test("sendTelegramLocation - handles non-403 blocked regex description", async (t) => {
  t.after(restoreGlobals);
  process.env.TELEGRAM_BOT_TOKEN = "test_token_123";

  setupMockFetch(async () => {
    return new Response(
      JSON.stringify({
        ok: false,
        error_code: 400,
        description: "Bad Request: chat not found",
      }),
      { status: 400 },
    );
  });

  const result = await sendTelegramLocation("12345", 53.9, 27.56);
  assert.deepEqual(result, {
    ok: false,
    error: "Bad Request: chat not found",
    blocked: true,
  });
});

test("sendTelegramLocation - handles generic unblocked API error response", async (t) => {
  t.after(restoreGlobals);
  process.env.TELEGRAM_BOT_TOKEN = "test_token_123";

  setupMockFetch(async () => {
    return new Response(
      JSON.stringify({
        ok: false,
        error_code: 400,
        description: "Bad Request: latitude is invalid",
      }),
      { status: 400 },
    );
  });

  const result = await sendTelegramLocation("12345", 53.9, 27.56);
  assert.deepEqual(result, {
    ok: false,
    error: "Bad Request: latitude is invalid",
    blocked: false,
  });
});

test("sendTelegramLocation - handles invalid JSON body response with fallback HTTP status", async (t) => {
  t.after(restoreGlobals);
  process.env.TELEGRAM_BOT_TOKEN = "test_token_123";

  setupMockFetch(async () => {
    return new Response("Internal Gateway Error HTML page", { status: 502 });
  });

  const result = await sendTelegramLocation("12345", 53.9, 27.56);
  assert.deepEqual(result, {
    ok: false,
    error: "http_502",
    blocked: false,
  });
});

test("sendTelegramLocation - handles fetch network error", async (t) => {
  t.after(restoreGlobals);
  process.env.TELEGRAM_BOT_TOKEN = "test_token_123";

  setupMockFetch(async () => {
    throw new Error("Network request failed");
  });

  const result = await sendTelegramLocation("12345", 53.9, 27.56);
  assert.deepEqual(result, {
    ok: false,
    error: "Network request failed",
  });
});

test("sendTelegramLocation - handles non-Error exception in fetch", async (t) => {
  t.after(restoreGlobals);
  process.env.TELEGRAM_BOT_TOKEN = "test_token_123";

  setupMockFetch(async () => {
    throw "String exception";
  });

  const result = await sendTelegramLocation("12345", 53.9, 27.56);
  assert.deepEqual(result, {
    ok: false,
    error: "fetch_failed",
  });
});

test("editTelegramMessageText - handles missing bot token and successful message edit", async (t) => {
  t.after(restoreGlobals);
  delete process.env.TELEGRAM_BOT_TOKEN;

  assert.deepEqual(
    await editTelegramMessageText("123", 456, "Updated text"),
    { ok: false, error: "missing_bot_token" },
  );

  process.env.TELEGRAM_BOT_TOKEN = "test_token";
  let capturedBody = null;
  setupMockFetch(async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  const res = await editTelegramMessageText("123", 456, "Updated text", {
    parseMode: "HTML",
    disableWebPagePreview: false,
  });

  assert.deepEqual(res, { ok: true });
  assert.deepEqual(capturedBody, {
    chat_id: "123",
    message_id: 456,
    text: "Updated text",
    parse_mode: "HTML",
    disable_web_page_preview: false,
  });
});

test("sendTelegramMessage - handles missing token, success with messageId, and options", async (t) => {
  t.after(restoreGlobals);
  delete process.env.TELEGRAM_BOT_TOKEN;

  assert.deepEqual(
    await sendTelegramMessage("123", "Hello"),
    { ok: false, error: "missing_bot_token" },
  );

  process.env.TELEGRAM_BOT_TOKEN = "test_token";
  let capturedBody = null;
  setupMockFetch(async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: 789 } }),
      { status: 200 },
    );
  });

  const res = await sendTelegramMessage("123", "Hello World", {
    parseMode: "MarkdownV2",
    disableNotification: true,
  });

  assert.deepEqual(res, { ok: true, messageId: 789 });
  assert.deepEqual(capturedBody, {
    chat_id: "123",
    text: "Hello World",
    parse_mode: "MarkdownV2",
    disable_notification: true,
    disable_web_page_preview: true,
  });
});

test("sendTelegramDocument - handles missing token, FormData payload, and successful result", async (t) => {
  t.after(restoreGlobals);
  delete process.env.TELEGRAM_BOT_TOKEN;

  const sampleFile = {
    bytes: new Uint8Array([1, 2, 3]),
    fileName: "doc.pdf",
    contentType: "application/pdf",
  };

  assert.deepEqual(
    await sendTelegramDocument("123", sampleFile),
    { ok: false, error: "missing_bot_token" },
  );

  process.env.TELEGRAM_BOT_TOKEN = "test_token";
  let capturedBody = null;
  setupMockFetch(async (_url, init) => {
    capturedBody = init.body;
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: 888 } }),
      { status: 200 },
    );
  });

  const res = await sendTelegramDocument("123", sampleFile, {
    caption: "My File",
    parseMode: "HTML",
  });

  assert.deepEqual(res, { ok: true, messageId: 888 });
  assert.ok(capturedBody instanceof FormData);
  assert.equal(capturedBody.get("chat_id"), "123");
  assert.equal(capturedBody.get("caption"), "My File");
  assert.equal(capturedBody.get("parse_mode"), "HTML");
});

test("deleteTelegramMessage - handles missing token and successful deletion", async (t) => {
  t.after(restoreGlobals);
  delete process.env.TELEGRAM_BOT_TOKEN;

  assert.deepEqual(
    await deleteTelegramMessage("123", 456),
    { ok: false, error: "missing_bot_token" },
  );

  process.env.TELEGRAM_BOT_TOKEN = "test_token";
  let capturedBody = null;
  setupMockFetch(async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  const res = await deleteTelegramMessage("123", 456);
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(capturedBody, { chat_id: "123", message_id: 456 });
});

test("answerTelegramCallback - handles missing token and sends callback answer", async (t) => {
  t.after(restoreGlobals);
  delete process.env.TELEGRAM_BOT_TOKEN;

  // Should return gracefully when token is missing
  await answerTelegramCallback("cb_123", "Alert text", true);

  process.env.TELEGRAM_BOT_TOKEN = "test_token";
  let capturedUrl = "";
  let capturedBody = null;
  setupMockFetch(async (url, init) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  await answerTelegramCallback("cb_123", "Alert text", true);
  assert.equal(capturedUrl, "https://api.telegram.org/bottest_token/answerCallbackQuery");
  assert.deepEqual(capturedBody, {
    callback_query_id: "cb_123",
    text: "Alert text",
    show_alert: true,
  });
});
