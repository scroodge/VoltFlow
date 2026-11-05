import assert from "node:assert/strict";
import { test } from "node:test";

import { searchKnowledge } from "./knowledge-search.ts";

test("searchKnowledge returns empty array for short or empty queries", async () => {
  const shortQueries = ["", "a", "   ", "  a  ", " x "];

  for (const query of shortQueries) {
    const results = await searchKnowledge({ query });
    assert.deepEqual(results, [], `Expected empty array for query: "${query}"`);
  }
});
