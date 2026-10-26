import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";

import {
  sendTelegramMessage,
  sendTelegramLocation,
  editTelegramMessageText,
  sendTelegramDocument,
  deleteTelegramMessage,
  answerTelegramCallback,
} from "./bot-send.ts";

const ORIGINAL_ENV = process.env.TELEGRAM_BOT_TOKEN;
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token-123";
});

afterEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_ENV;
  globalThis.fetch = ORIGINAL_FETCH;
});

test("sendTelegramMessage returns missing_bot_token when token is missing", async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  const result = await sendTelegramMessage(12345, "Hello world");
  assert.deepEqual(result, { ok: false, error: "missing_bot_token" });
});

test("sendTelegramMessage handles successful delivery", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.telegram.org/bottest-token-123/sendMessage");
    assert.equal(options?.method, "POST");
    const body = JSON.parse(options?.body);
    assert.equal(body.chat_id, 12345);
    assert.equal(body.text, "Hello test");
    assert.equal(body.disable_web_page_preview, true);

    return new Response(
      JSON.stringify({
        ok: true,
        result: { message_id: 987 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await sendTelegramMessage(12345, "Hello test");
  assert.deepEqual(result, { ok: true, messageId: 987 });
});

test("sendTelegramMessage handles 403 blocked / chat not found responses", async () => {
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        ok: false,
        error_code: 403,
        description: "Forbidden: bot was blocked by the user",
      }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  };

  const result = await sendTelegramMessage(12345, "Hello test");
  assert.deepEqual(result, {
    ok: false,
    error: "Forbidden: bot was blocked by the user",
    blocked: true,
  });
});

test("sendTelegramMessage handles non-JSON HTTP failure responses", async () => {
  globalThis.fetch = async () => {
    return new Response("Internal Server Error", { status: 500 });
  };

  const result = await sendTelegramMessage(12345, "Hello test");
  assert.deepEqual(result, {
    ok: false,
    error: "http_500",
    blocked: false,
  });
});

test("sendTelegramMessage catches fetch network exceptions with Error instance", async () => {
  globalThis.fetch = async () => {
    throw new Error("Network request failed");
  };

  const result = await sendTelegramMessage(12345, "Hello test");
  assert.deepEqual(result, {
    ok: false,
    error: "Network request failed",
  });
});

test("sendTelegramMessage catches non-Error fetch exceptions", async () => {
  globalThis.fetch = async () => {
    throw "unknown network drop";
  };

  const result = await sendTelegramMessage(12345, "Hello test");
  assert.deepEqual(result, {
    ok: false,
    error: "fetch_failed",
  });
});

test("sendTelegramLocation handles success, error responses, and fetch exceptions", async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  assert.deepEqual(await sendTelegramLocation(123, 53.9, 27.5), {
    ok: false,
    error: "missing_bot_token",
  });

  process.env.TELEGRAM_BOT_TOKEN = "test-token-123";

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 });
  assert.deepEqual(await sendTelegramLocation(123, 53.9, 27.5), { ok: true });

  globalThis.fetch = async () => {
    throw new Error("DNS resolution failed");
  };
  assert.deepEqual(await sendTelegramLocation(123, 53.9, 27.5), {
    ok: false,
    error: "DNS resolution failed",
  });
});

test("editTelegramMessageText handles success, missing token, and fetch exceptions", async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  assert.deepEqual(await editTelegramMessageText(123, 45, "new text"), {
    ok: false,
    error: "missing_bot_token",
  });

  process.env.TELEGRAM_BOT_TOKEN = "test-token-123";

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 });
  assert.deepEqual(await editTelegramMessageText(123, 45, "new text"), {
    ok: true,
  });

  globalThis.fetch = async () => {
    throw new Error("Connection reset");
  };
  assert.deepEqual(await editTelegramMessageText(123, 45, "new text"), {
    ok: false,
    error: "Connection reset",
  });
});

test("sendTelegramDocument handles success, missing token, and fetch exceptions", async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  const file = {
    bytes: new Uint8Array([1, 2, 3]),
    fileName: "doc.txt",
    contentType: "text/plain",
  };
  assert.deepEqual(await sendTelegramDocument(123, file), {
    ok: false,
    error: "missing_bot_token",
  });

  process.env.TELEGRAM_BOT_TOKEN = "test-token-123";

  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.telegram.org/bottest-token-123/sendDocument");
    assert.ok(options?.body instanceof FormData);
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: 55 } }),
      { status: 200 },
    );
  };
  assert.deepEqual(await sendTelegramDocument(123, file, { caption: "test cap" }), {
    ok: true,
    messageId: 55,
  });

  globalThis.fetch = async () => {
    throw new Error("Upload socket closed");
  };
  assert.deepEqual(await sendTelegramDocument(123, file), {
    ok: false,
    error: "Upload socket closed",
  });
});

test("deleteTelegramMessage handles success, missing token, and fetch exceptions", async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  assert.deepEqual(await deleteTelegramMessage(123, 45), {
    ok: false,
    error: "missing_bot_token",
  });

  process.env.TELEGRAM_BOT_TOKEN = "test-token-123";

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 });
  assert.deepEqual(await deleteTelegramMessage(123, 45), { ok: true });

  globalThis.fetch = async () => {
    throw new Error("Timeout deleting message");
  };
  assert.deepEqual(await deleteTelegramMessage(123, 45), {
    ok: false,
    error: "Timeout deleting message",
  });
});

test("answerTelegramCallback handles missing token, success, and fetch errors", async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  await assert.doesNotReject(() => answerTelegramCallback("cb-123", "Alert text"));

  process.env.TELEGRAM_BOT_TOKEN = "test-token-123";

  globalThis.fetch = async () => new Response("{}", { status: 200 });
  await assert.doesNotReject(() => answerTelegramCallback("cb-123", "Alert text"));

  globalThis.fetch = async () => {
    throw new Error("Callback error");
  };
  await assert.doesNotReject(() => answerTelegramCallback("cb-123", "Alert text"));
});
