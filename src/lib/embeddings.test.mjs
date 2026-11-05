import assert from "node:assert/strict";
import { test } from "node:test";

import { buildKnowledgeEmbeddingText } from "./embeddings.ts";

test("buildKnowledgeEmbeddingText includes all fields when category and tags are provided", () => {
  const result = buildKnowledgeEmbeddingText({
    title: "Зарядка аккумулятора",
    category: "guide",
    tags: ["зарядка", "батарея"],
    content: "Инструкция по безопасной зарядке батареи.",
  });

  const expected = [
    "Название: Зарядка аккумулятора",
    "Категория: guide",
    "Теги: зарядка, батарея",
    "Содержание: Инструкция по безопасной зарядке батареи.",
  ].join("\n");

  assert.equal(result, expected);
});

test("buildKnowledgeEmbeddingText defaults category to 'faq' when category is omitted", () => {
  const result = buildKnowledgeEmbeddingText({
    title: "Как обновить ПО",
    tags: ["прошивка"],
    content: "Перейдите в настройки системы.",
  });

  const expected = [
    "Название: Как обновить ПО",
    "Категория: faq",
    "Теги: прошивка",
    "Содержание: Перейдите в настройки системы.",
  ].join("\n");

  assert.equal(result, expected);
});

test("buildKnowledgeEmbeddingText omits tags line when tags array is missing or empty", () => {
  const resultNoTags = buildKnowledgeEmbeddingText({
    title: "Давление в шинах",
    category: "maintenance",
    content: "Рекомендуемое давление 2.5 бар.",
  });

  const expectedNoTags = [
    "Название: Давление в шинах",
    "Категория: maintenance",
    "Содержание: Рекомендуемое давление 2.5 бар.",
  ].join("\n");

  assert.equal(resultNoTags, expectedNoTags);

  const resultEmptyTags = buildKnowledgeEmbeddingText({
    title: "Давление в шинах",
    category: "maintenance",
    tags: [],
    content: "Рекомендуемое давление 2.5 бар.",
  });

  assert.equal(resultEmptyTags, expectedNoTags);
});

test("buildKnowledgeEmbeddingText handles single tag and special characters properly", () => {
  const result = buildKnowledgeEmbeddingText({
    title: "Замена салонного фильтра (AC & DC)",
    category: "service",
    tags: ["фильтр"],
    content: "Строка 1\nСтрока 2 c символами: 100%, 2.5 kW.",
  });

  const expected = [
    "Название: Замена салонного фильтра (AC & DC)",
    "Категория: service",
    "Теги: фильтр",
    "Содержание: Строка 1\nСтрока 2 c символами: 100%, 2.5 kW.",
  ].join("\n");

  assert.equal(result, expected);
});
