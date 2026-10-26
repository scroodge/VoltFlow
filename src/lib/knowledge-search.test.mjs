import assert from "node:assert/strict";
import test from "node:test";

import * as embeddingsModule from "./embeddings.ts";
import {
  invalidateKnowledgeSearchCache,
  isKnowledgeSourceType,
  searchKnowledge,
} from "./knowledge-search.ts";
import * as supabaseAdminModule from "./supabase/admin.ts";

test("isKnowledgeSourceType validates known source types", () => {
  const validTypes = [
    "article",
    "faq",
    "accessory",
    "spare_part",
    "service_provider",
    "manual",
    "seed",
  ];

  for (const type of validTypes) {
    assert.equal(isKnowledgeSourceType(type), true, `Expected ${type} to be valid`);
  }

  assert.equal(isKnowledgeSourceType("invalid_type"), false);
  assert.equal(isKnowledgeSourceType(123), false);
  assert.equal(isKnowledgeSourceType(null), false);
  assert.equal(isKnowledgeSourceType(undefined), false);
  assert.equal(isKnowledgeSourceType({}), false);
});

test("searchKnowledge returns empty array for queries under 2 characters without calling search", async () => {
  const result = await searchKnowledge({ query: "a" });
  assert.deepEqual(result, []);
});

test("searchKnowledge caches result and invalidateKnowledgeSearchCache clears the cache", async (t) => {
  invalidateKnowledgeSearchCache();

  let embeddingCallCount = 0;
  let rpcCallCount = 0;

  const mockEmbedding = new Array(1536).fill(0.1);
  const mockSearchResult = [
    {
      id: "item-1",
      title: "Test Item",
      content: "Test Content",
      category: "faq",
      source_type: "faq",
      source_url: null,
      telegram_message_id: null,
      tags: ["test"],
      similarity: 0.8,
    },
  ];

  t.mock.method(embeddingsModule, "createEmbedding", async (query) => {
    embeddingCallCount++;
    return mockEmbedding;
  });

  t.mock.method(supabaseAdminModule, "getSupabaseAdmin", () => {
    return {
      rpc: async (fnName, params) => {
        rpcCallCount++;
        return { data: mockSearchResult, error: null };
      },
    };
  });

  const queryParams = { query: "charging speed test" };

  // First call: populates cache and triggers underlying search calls
  const res1 = await searchKnowledge(queryParams);
  assert.deepEqual(res1, mockSearchResult);
  assert.equal(embeddingCallCount, 1);
  assert.equal(rpcCallCount, 1);

  // Second call with same params: should return cached promise, without calling underlying search
  const res2 = await searchKnowledge(queryParams);
  assert.deepEqual(res2, mockSearchResult);
  assert.equal(embeddingCallCount, 1);
  assert.equal(rpcCallCount, 1);

  // Invalidate cache
  invalidateKnowledgeSearchCache();

  // Third call after invalidation: should call search again
  const res3 = await searchKnowledge(queryParams);
  assert.deepEqual(res3, mockSearchResult);
  assert.equal(embeddingCallCount, 2);
  assert.equal(rpcCallCount, 2);

  invalidateKnowledgeSearchCache();
});

test("searchKnowledge deletes cache key on search error", async (t) => {
  invalidateKnowledgeSearchCache();

  let attemptCount = 0;

  t.mock.method(embeddingsModule, "createEmbedding", async () => {
    attemptCount++;
    if (attemptCount === 1) {
      throw new Error("RPC or API error");
    }
    return new Array(1536).fill(0.1);
  });

  t.mock.method(supabaseAdminModule, "getSupabaseAdmin", () => {
    return {
      rpc: async () => ({ data: [], error: null }),
    };
  });

  const queryParams = { query: "error handling test" };

  // First call fails
  await assert.rejects(() => searchKnowledge(queryParams), /RPC or API error/);

  // Second call after failure should retry (not hit cache error)
  const res = await searchKnowledge(queryParams);
  assert.deepEqual(res, []);
  assert.equal(attemptCount, 2);

  invalidateKnowledgeSearchCache();
});
