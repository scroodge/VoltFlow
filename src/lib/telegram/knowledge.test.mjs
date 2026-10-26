import assert from "node:assert/strict";
import test from "node:test";

import { getCategoryContent, staticTelegramKnowledgeData } from "./knowledge.ts";

test("getCategoryContent returns filtered articles, faq, and accessories for category slug 'charging'", () => {
  const content = getCategoryContent("charging");

  assert.ok(Array.isArray(content.articles));
  assert.ok(Array.isArray(content.faq));
  assert.ok(Array.isArray(content.accessories));
  assert.ok(Array.isArray(content.spareParts));

  assert.ok(content.articles.length > 0, "expected charging category to have articles");
  assert.ok(
    content.articles.every((article) => article.categorySlug === "charging"),
    "all articles returned should have categorySlug 'charging'",
  );

  assert.ok(content.faq.length > 0, "expected charging category to have faq items");
  assert.ok(
    content.faq.every((item) => item.categorySlug === "charging"),
    "all faq items returned should have categorySlug 'charging'",
  );

  assert.deepEqual(content.spareParts, [], "spareParts should be empty for non-spare-parts category");
});

test("getCategoryContent returns filtered accessories for 'accessories' category", () => {
  const content = getCategoryContent("accessories");

  assert.ok(content.accessories.length > 0, "expected accessories category to have accessory items");
  assert.ok(
    content.accessories.every((item) => item.categorySlug === "accessories"),
    "all accessory items should have categorySlug 'accessories'",
  );
  assert.deepEqual(content.spareParts, []);
});

test("getCategoryContent populates spareParts only when slug is 'spare-parts'", () => {
  const content = getCategoryContent("spare-parts");

  assert.ok(
    content.spareParts.length > 0,
    "expected spareParts to be populated when slug is 'spare-parts'",
  );
  assert.deepEqual(
    content.spareParts,
    staticTelegramKnowledgeData.spareParts,
    "spareParts should match staticTelegramKnowledgeData.spareParts",
  );
});

test("getCategoryContent returns empty arrays for an unknown category slug", () => {
  const content = getCategoryContent("unknown-category-slug-12345");

  assert.deepEqual(content, {
    articles: [],
    faq: [],
    accessories: [],
    spareParts: [],
  });
});
