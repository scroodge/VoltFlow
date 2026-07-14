import assert from "node:assert/strict";
import { test } from "node:test";

import { classifySearchConfidence } from "./knowledge-search-confidence.ts";

const sims = (...values) => values.map((similarity) => ({ similarity }));

/**
 * Real similarity scores, recorded from the live corpus on 2026-07-14. These pin the rule
 * down — in particular the overlap that makes a flat threshold unusable.
 */
test("real eval scores: every query is classified correctly", () => {
  const cases = [
    ["медленная зарядка вредна", sims(0.653, 0.599, 0.591), true],
    ["как продлить ресурс батареи", sims(0.615, 0.53, 0.464), true],
    ["можно ли заряжать до 100%", sims(0.57, 0.402, 0.376), true],
    ["сел аккумулятор 12в", sims(0.561, 0.513, 0.444), true],
    ["какой кабель нужен", sims(0.552, 0.483, 0.481), true],
    ["когда менять салонный фильтр", sims(0.55, 0.416, 0.339), true],
    ["руль стал легкий", sims(0.505, 0.226, 0.213), true],
    ["что такое кВт·ч", sims(0.494), true],
    ["задний фонарь треснул", sims(0.462, 0.306, 0.302), true],
    // Correct answer, but BELOW the similarity floor — saved only by its clear lead.
    ["коврики в салон", sims(0.423, 0.335, 0.316), true],
    // No winter-charging article exists. Near-tie among unrelated items → admit defeat.
    ["как заряжать зимой", sims(0.417, 0.369, 0.367), false],
    // No AC-vs-DC article exists either.
    ["чем отличается AC от DC", sims(0.434, 0.415, 0.413), false],
  ];

  for (const [name, results, expected] of cases) {
    assert.equal(
      classifySearchConfidence(results).confident,
      expected,
      `${name}: expected confident=${expected}`,
    );
  }
});

test("the overlap a flat threshold cannot resolve", () => {
  // The correct hit (0.423) scores essentially the same as a wrong one (0.417) — 0.006
  // apart. Any single cutoff either keeps both or drops both. Only the lead separates them.
  const rightAnswer = classifySearchConfidence(sims(0.423, 0.335));
  const wrongAnswer = classifySearchConfidence(sims(0.417, 0.369));

  assert.equal(rightAnswer.confident, true);
  assert.equal(wrongAnswer.confident, false);
  assert.ok(rightAnswer.topSimilarity - wrongAnswer.topSimilarity < 0.01);
});

test("a strong top hit is trusted even with a close runner-up", () => {
  // 0.653 vs 0.599 is only a 0.054 lead — under CONFIDENT_LEAD — but the score itself is
  // high and the runner-up is also relevant. The floor has to carry this one.
  assert.equal(classifySearchConfidence(sims(0.653, 0.599)).confident, true);
});

test("a lone weak result is not an answer", () => {
  assert.equal(classifySearchConfidence(sims(0.3)).confident, false);
});

test("a lone strong result is an answer", () => {
  assert.equal(classifySearchConfidence(sims(0.494)).confident, true);
});

test("no results is never confident", () => {
  const outcome = classifySearchConfidence([]);
  assert.equal(outcome.confident, false);
  assert.equal(outcome.topSimilarity, 0);
  assert.equal(outcome.lead, null);
});
