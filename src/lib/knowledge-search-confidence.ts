import type { KnowledgeSearchResult } from "./knowledge-search.ts";

/**
 * A top hit at or above this similarity is trusted on its own.
 *
 * Derived from a 12-query eval against the real corpus
 * (scripts/knowledge-search-eval.mjs), not picked by feel.
 */
export const CONFIDENT_SIMILARITY = 0.45;

/**
 * ...but a weaker top hit is still trusted if it clearly *beats* the runner-up by this much.
 *
 * Both rules are needed, because the scores overlap: the CORRECT hit for "коврики в салон"
 * scores 0.423, while the WRONG hit for "как заряжать зимой" (winter washer fluid, on a
 * charging question) scores 0.417. A single flat threshold cannot separate those — raising
 * it to 0.45 would drop a right answer in order to suppress a wrong one. What distinguishes
 * them is the lead: "коврики" beats its runner-up by 0.088, while "зимой" leads by only
 * 0.048 — a near-tie among unrelated items, i.e. the model has no real opinion.
 */
export const CONFIDENT_LEAD = 0.06;

export type SearchConfidence = {
  /** True when the top hit can be presented as an answer. */
  confident: boolean;
  topSimilarity: number;
  /** Lead of #1 over #2; null when there is nothing to compare against. */
  lead: number | null;
};

/**
 * Decides whether a result set actually answers the question, or merely contains the least
 * unrelated things we happen to have.
 *
 * The knowledge base is small and will always have gaps. Without this, a query with no
 * answer at all ("как заряжать зимой" — the corpus has no winter-charging article) still
 * returned winter *washer fluid* at 42% and the UI presented it as a result. Better to say
 * we don't know than to confidently hand over the wrong thing.
 */
export function classifySearchConfidence(
  results: Pick<KnowledgeSearchResult, "similarity">[],
): SearchConfidence {
  const top = results[0]?.similarity ?? 0;
  const second = results[1]?.similarity;
  const lead = typeof second === "number" ? top - second : null;

  const confident =
    results.length > 0 &&
    (top >= CONFIDENT_SIMILARITY || (lead !== null && lead >= CONFIDENT_LEAD));

  return { confident, topSimilarity: top, lead };
}
