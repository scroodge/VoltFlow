import assert from "node:assert/strict";
import test from "node:test";

import {
  getLlmConfig,
  isPublishableVerification,
  parseVerification,
  reviewFallback,
  verifyTelegramContext,
} from "./llm-context-verifier.ts";

const env = {
  LLM_BASE_URL: "https://dev.offtech.by:8444/ollama/v1",
  LLM_MODEL: "qwen2.5:14b",
  LLM_API_KEY: "ollama",
  LLM_MAX_TOKENS: "512",
};

test("reads the Ollama-compatible LLM configuration", () => {
  assert.deepEqual(getLlmConfig({ ...env, LLM_BASE_URL: "https://dev.offtech.by:8444/ollama" }), {
    baseUrl: "https://dev.offtech.by:8444/ollama/v1",
    model: "qwen2.5:14b",
    apiKey: "ollama",
    maxTokens: 512,
  });
});

test("rejects incomplete or unsafe LLM configuration", () => {
  assert.throws(() => getLlmConfig({ ...env, LLM_API_KEY: "" }));
  assert.throws(() => getLlmConfig({ ...env, LLM_MAX_TOKENS: "32" }));
});

test("parses a seller result and forces safe review for low confidence", () => {
  const result = parseVerification(JSON.stringify({
    intent: "sell",
    confidence: 0.74,
    title: "Kraft AGM 40",
    item_type: "spare_part",
    city: "Новолуцк",
    generation: "gen1_2024",
    price: 250,
    currency: "BYN",
    contact: null,
    actionable: true,
    needs_review: false,
    reason: "The author offers an item for sale.",
  }));

  assert.equal(result.intent, "sell");
  assert.equal(result.actionable, false);
  assert.equal(result.needsReview, true);
  assert.equal(result.city, "Новолуцк");
  assert.equal(isPublishableVerification(result), false);
});

test("rejects invented or unsupported intent values into review", () => {
  const result = parseVerification(JSON.stringify({
    intent: "publish_now",
    confidence: 1,
    actionable: true,
    needs_review: false,
    reason: "unknown",
  }));

  assert.equal(result.intent, "ambiguous");
  assert.equal(result.actionable, false);
  assert.equal(result.needsReview, true);
});

test("accepts a fenced JSON response from a model", () => {
  const result = parseVerification("```json\n{\"intent\":\"question\",\"confidence\":0.9,\"actionable\":false,\"needs_review\":false,\"reason\":\"Technical question\"}\n```");
  assert.equal(result.intent, "question");
  assert.equal(result.needsReview, false);
});

test("fails closed when the LLM is not configured", async () => {
  assert.deepEqual(await verifyTelegramContext("Куплю зарядный кабель", { env: {} }), reviewFallback("Missing LLM_BASE_URL, LLM_MODEL, or LLM_API_KEY."));
});

test("sends the Telegram message to the configured chat model", async () => {
  let request;
  const result = await verifyTelegramContext("Продам аккумулятор AGM 40, 250 BYN", {
    env,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: "sell",
              confidence: 0.96,
              title: "Аккумулятор AGM 40",
              item_type: "spare_part",
              city: null,
              generation: null,
              price: 250,
              currency: "BYN",
              contact: null,
              actionable: true,
              needs_review: false,
              reason: "Explicit sale offer.",
            }),
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(request.url, "https://dev.offtech.by:8444/ollama/v1/chat/completions");
  assert.equal(JSON.parse(request.init.body).model, "qwen2.5:14b");
  assert.equal(JSON.parse(request.init.body).max_tokens, 512);
  assert.equal(result.intent, "sell");
  assert.equal(result.actionable, true);
  assert.equal(isPublishableVerification(result), true);
});

test("returns a review result on provider failure", async () => {
  const result = await verifyTelegramContext("Куплю зарядный кабель", {
    env,
    fetchImpl: async () => new Response("upstream failure", { status: 503 }),
  });
  assert.equal(result.intent, "ambiguous");
  assert.equal(result.needsReview, true);
  assert.equal(result.reason, "llm_http_503");
});
