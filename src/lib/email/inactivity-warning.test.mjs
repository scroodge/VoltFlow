import test from "node:test";
import assert from "node:assert/strict";
import { Resend } from "resend";

import { sendInactivityWarning } from "./inactivity-warning.ts";

test("sendInactivityWarning returns { ok: true } on successful email delivery", async () => {
  const originalPost = Resend.prototype.post;
  let capturedEntity = null;

  Resend.prototype.post = async function (path, entity, options) {
    if (path === "/emails") {
      capturedEntity = entity;
      return { data: { id: "msg_123" }, error: null };
    }
    return originalPost.call(this, path, entity, options);
  };

  try {
    const result = await sendInactivityWarning("user@example.com");
    assert.deepEqual(result, { ok: true });
    assert.equal(capturedEntity?.to, "user@example.com");
    assert.equal(capturedEntity?.from, "VoltFlow <noreply@voltflow.life>");
    assert.match(capturedEntity?.subject ?? "", /account will be deleted/i);
    assert.match(capturedEntity?.text ?? "", /https:\/\/voltflow.life\/login/);
  } finally {
    Resend.prototype.post = originalPost;
  }
});

test("sendInactivityWarning returns { ok: false, error } on Resend API error result", async () => {
  const originalPost = Resend.prototype.post;

  Resend.prototype.post = async function (path, entity, options) {
    if (path === "/emails") {
      return { data: null, error: { message: "Domain not verified", name: "validation_error" } };
    }
    return originalPost.call(this, path, entity, options);
  };

  try {
    const result = await sendInactivityWarning("user@example.com");
    assert.deepEqual(result, { ok: false, error: "Domain not verified" });
  } finally {
    Resend.prototype.post = originalPost;
  }
});

test("sendInactivityWarning catches Error exceptions and returns error message", async () => {
  const originalPost = Resend.prototype.post;

  Resend.prototype.post = async function (path, entity, options) {
    if (path === "/emails") {
      throw new Error("Network timeout");
    }
    return originalPost.call(this, path, entity, options);
  };

  try {
    const result = await sendInactivityWarning("user@example.com");
    assert.deepEqual(result, { ok: false, error: "Network timeout" });
  } finally {
    Resend.prototype.post = originalPost;
  }
});

test("sendInactivityWarning catches non-Error exceptions and returns Unknown error", async () => {
  const originalPost = Resend.prototype.post;

  Resend.prototype.post = async function (path, entity, options) {
    if (path === "/emails") {
      throw "String exception";
    }
    return originalPost.call(this, path, entity, options);
  };

  try {
    const result = await sendInactivityWarning("user@example.com");
    assert.deepEqual(result, { ok: false, error: "Unknown error" });
  } finally {
    Resend.prototype.post = originalPost;
  }
});
