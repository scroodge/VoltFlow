import test from "node:test";
import assert from "node:assert/strict";

import { readBodyWithLimit, RequestBodyTooLargeError } from "./read-body.ts";

test("returns empty Uint8Array when request.body is null", async () => {
  const req = new Request("https://example.com", { method: "GET" });
  const result = await readBodyWithLimit(req, 100);
  assert.equal(result instanceof Uint8Array, true);
  assert.equal(result.byteLength, 0);
});

test("reads single-chunk body within limit", async () => {
  const encoder = new TextEncoder();
  const data = encoder.encode("Hello World");
  const req = new Request("https://example.com", {
    method: "POST",
    body: data,
  });

  const result = await readBodyWithLimit(req, 100);
  const decoder = new TextDecoder();
  assert.equal(decoder.decode(result), "Hello World");
});

test("reads multi-chunk stream within limit", async () => {
  const encoder = new TextEncoder();
  const chunk1 = encoder.encode("Hello ");
  const chunk2 = encoder.encode("World");

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(chunk1);
      controller.enqueue(chunk2);
      controller.close();
    },
  });

  const req = new Request("https://example.com", {
    method: "POST",
    body: stream,
    duplex: "half",
  });

  const result = await readBodyWithLimit(req, 100);
  const decoder = new TextDecoder();
  assert.equal(decoder.decode(result), "Hello World");
});

test("reads body exactly at limit size boundary", async () => {
  const encoder = new TextEncoder();
  const data = encoder.encode("1234567890"); // 10 bytes

  const req = new Request("https://example.com", {
    method: "POST",
    body: data,
  });

  const result = await readBodyWithLimit(req, 10);
  assert.equal(result.byteLength, 10);
});

test("throws RequestBodyTooLargeError and cancels stream when limit is exceeded across multiple chunks", async () => {
  let canceled = false;
  let cancelReason = null;

  const encoder = new TextEncoder();
  const chunk1 = encoder.encode("12345"); // 5 bytes
  const chunk2 = encoder.encode("678901"); // 6 bytes -> total 11 bytes

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(chunk1);
      controller.enqueue(chunk2);
    },
    cancel(reason) {
      canceled = true;
      cancelReason = reason;
    },
  });

  const req = new Request("https://example.com", {
    method: "POST",
    body: stream,
    duplex: "half",
  });

  await assert.rejects(
    async () => {
      await readBodyWithLimit(req, 10);
    },
    (err) => {
      assert.equal(err instanceof RequestBodyTooLargeError, true);
      assert.equal(err.name, "RequestBodyTooLargeError");
      assert.equal(err.message, "PAYLOAD_TOO_LARGE");
      return true;
    }
  );

  assert.equal(canceled, true);
});
