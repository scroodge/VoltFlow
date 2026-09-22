import assert from "node:assert/strict";
import test from "node:test";

import {
  KnowledgeImageValidationError,
  validateKnowledgeImage,
} from "./knowledge-image-validation.ts";

function imageFile(name, type, bytes) {
  return {
    name,
    type,
    size: bytes.length,
    slice(start = 0, end = bytes.length) {
      const view = bytes.slice(start, end);
      return {
        async arrayBuffer() {
          return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
        },
      };
    },
  };
}

test("accepts JPEG, PNG, and WebP signatures", async () => {
  await assert.doesNotReject(() =>
    validateKnowledgeImage(imageFile("photo.jpeg", "image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))),
  );
  await assert.doesNotReject(() =>
    validateKnowledgeImage(imageFile("photo.png", "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))),
  );
  await assert.doesNotReject(() =>
    validateKnowledgeImage(imageFile("photo.webp", "image/webp", new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]))),
  );
});

test("derives the Storage content type and extension from image bytes", async () => {
  const result = await validateKnowledgeImage(
    imageFile("untrusted-name.exe", "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  );

  assert.deepEqual(result, { contentType: "image/png", extension: "png" });
});

test("rejects unsupported content and MIME/signature mismatches", async () => {
  await assert.rejects(
    () => validateKnowledgeImage(imageFile("photo.gif", "image/gif", new Uint8Array([71, 73, 70, 56]))),
    KnowledgeImageValidationError,
  );
  await assert.rejects(
    () => validateKnowledgeImage(imageFile("photo.png", "image/png", new Uint8Array([0xff, 0xd8, 0xff]))),
    /не совпадает/,
  );
});
