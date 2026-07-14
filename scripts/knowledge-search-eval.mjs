#!/usr/bin/env node
/**
 * Relevance eval for the knowledge-base semantic search.
 *
 * Turns "search feels bad" into a number. Run it before and after any change to the
 * embeddings, the threshold, `buildKnowledgeEmbeddingText`, or the corpus — without it,
 * tuning retrieval is guessing, and a "fix" that quietly breaks three other queries looks
 * identical to one that works.
 *
 * Two cases (expect: null) have NO answer in the corpus. They are not bugs to be tuned
 * away — they are content gaps, and they sit here so that a change which starts
 * confidently answering them gets caught.
 *
 * Usage:
 *   npm run dev                            # in another terminal
 *   npm run search:eval
 *   node scripts/knowledge-search-eval.mjs http://localhost:3000
 */

const BASE = process.argv[2] ?? "http://localhost:3000";
const SOURCE_TYPES = ["article", "faq", "accessory", "spare_part"];

/** expect = title that should rank #1, or null when the corpus has no answer. */
const CASES = [
  { query: "медленная зарядка вредна", expect: "Медленная AC-зарядка" },
  { query: "как продлить ресурс батареи", expect: "Уход за батареей" },
  {
    query: "можно ли заряжать до 100 процентов",
    expect: "Нужно ли заряжать до 100% каждый день?",
  },
  { query: "сел аккумулятор 12в", expect: "Малый Аккумулятор" },
  { query: "какой кабель нужен для зарядки", expect: "Кабель Type 2" },
  { query: "коврики в салон", expect: "Резиновые коврики" },
  { query: "когда менять салонный фильтр", expect: "Фильтр салонный" },
  { query: "что такое кВт·ч", expect: "В чем разница между кВт и кВт⋅ч?" },
  {
    query: "руль стал легкий",
    expect:
      "Руль как бы стал легким совсем, очень свободно крутиться. Не знаете с чем может быть связано?",
  },
  { query: "задний фонарь треснул", expect: "Проблемы с задним фонарем" },
  // Content gaps — no such article exists. Search must NOT claim an answer.
  { query: "как заряжать зимой", expect: null },
  { query: "чем отличается AC от DC", expect: null },
];

// Mirrors src/lib/knowledge-search-confidence.ts (this script talks to the HTTP API, not
// the module). If you change the constants there, change them here.
const CONFIDENT_SIMILARITY = 0.45;
const CONFIDENT_LEAD = 0.06;

function isConfident(results) {
  const top = results[0]?.similarity ?? 0;
  const second = results[1]?.similarity;
  const lead = typeof second === "number" ? top - second : null;
  return (
    results.length > 0 &&
    (top >= CONFIDENT_SIMILARITY || (lead !== null && lead >= CONFIDENT_LEAD))
  );
}

async function search(query) {
  const response = await fetch(`${BASE}/api/knowledge/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, sourceTypes: SOURCE_TYPES, limit: 3 }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${body.detail ?? body.error ?? "unknown"}`);
  }
  return body.results ?? [];
}

let passed = 0;

for (const { query, expect } of CASES) {
  let results;
  try {
    results = await search(query);
  } catch (error) {
    console.log(`FAIL  ${query}\n        request failed: ${error.message}`);
    continue;
  }

  const top = results[0];
  const confident = isConfident(results);

  // A gap query passes by NOT claiming an answer. A normal query passes by ranking the
  // right item first AND being confident enough to present it as an answer.
  const ok = expect === null ? !confident : confident && top?.title === expect;

  if (ok) passed += 1;

  const detail = top
    ? `${top.similarity.toFixed(3)} ${confident ? "[answer]" : "[unsure]"} ${top.title}`
    : "no results";

  console.log(`${ok ? "PASS" : "FAIL"}  ${query}\n        ${detail}`);
  if (!ok) {
    console.log(
      `        expected: ${expect === null ? "no confident answer (content gap)" : expect}`,
    );
  }
}

console.log(`\n${passed}/${CASES.length} passed`);
process.exit(passed === CASES.length ? 0 : 1);
