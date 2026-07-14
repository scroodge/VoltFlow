import { createEmbedding } from "@/lib/embeddings";
import { isCarGeneration, type CarGeneration } from "@/lib/car-generations";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type KnowledgeSearchResult = {
  id: string;
  title: string;
  content: string;
  category: string;
  source_type: string;
  source_url: string | null;
  telegram_message_id: string | null;
  tags: string[];
  similarity: number;
};

export type KnowledgeSourceType =
  | "article"
  | "faq"
  | "accessory"
  | "spare_part"
  | "service_provider"
  | "manual"
  | "seed";

const knowledgeSourceTypes = new Set<KnowledgeSourceType>([
  "article",
  "faq",
  "accessory",
  "spare_part",
  "service_provider",
  "manual",
  "seed",
]);

const KNOWLEDGE_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const KNOWLEDGE_SEARCH_CACHE_MAX_ENTRIES = 100;

type KnowledgeSearchCacheEntry = {
  expiresAt: number;
  promise: Promise<KnowledgeSearchResult[]>;
};

const knowledgeSearchCache = new Map<string, KnowledgeSearchCacheEntry>();

export function isKnowledgeSourceType(value: unknown): value is KnowledgeSourceType {
  return typeof value === "string" && knowledgeSourceTypes.has(value as KnowledgeSourceType);
}

export async function searchKnowledge(params: {
  query: string;
  category?: string | null;
  generation?: CarGeneration | null;
  sourceTypes?: KnowledgeSourceType[] | null;
  limit?: number;
}) {
  const query = normalizeSearchText(params.query);

  if (query.length < 2) {
    return [];
  }

  const cacheKey = createSearchCacheKey({
    ...params,
    query,
  });
  const cached = readSearchCache(cacheKey);
  if (cached) return cached;

  const promise = runKnowledgeSearch({
    ...params,
    query,
  });
  writeSearchCache(cacheKey, promise);

  try {
    return await promise;
  } catch (error) {
    knowledgeSearchCache.delete(cacheKey);
    throw error;
  }
}

export function invalidateKnowledgeSearchCache() {
  knowledgeSearchCache.clear();
}

async function runKnowledgeSearch(params: {
  query: string;
  category?: string | null;
  generation?: CarGeneration | null;
  sourceTypes?: KnowledgeSourceType[] | null;
  limit?: number;
}) {
  const embedding = await createEmbedding(params.query);

  const { data, error } = await supabaseAdmin.rpc("match_knowledge_items", {
    query_embedding: embedding,
    match_threshold: 0.2,
    match_count: params.limit ?? 8,
    filter_category: params.category || null,
    filter_generation: isCarGeneration(params.generation) ? params.generation : null,
    filter_source_types: params.sourceTypes?.length ? params.sourceTypes : null,
  });

  if (error) {
    throw new Error(`Knowledge search failed: ${error.message}`);
  }

  return (data ?? []) as KnowledgeSearchResult[];
}

function readSearchCache(cacheKey: string) {
  const entry = knowledgeSearchCache.get(cacheKey);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    knowledgeSearchCache.delete(cacheKey);
    return null;
  }

  return entry.promise;
}

function writeSearchCache(cacheKey: string, promise: Promise<KnowledgeSearchResult[]>) {
  knowledgeSearchCache.set(cacheKey, {
    expiresAt: Date.now() + KNOWLEDGE_SEARCH_CACHE_TTL_MS,
    promise,
  });

  if (knowledgeSearchCache.size > KNOWLEDGE_SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = knowledgeSearchCache.keys().next().value;
    if (oldestKey) knowledgeSearchCache.delete(oldestKey);
  }
}

function createSearchCacheKey(params: {
  query: string;
  category?: string | null;
  generation?: CarGeneration | null;
  sourceTypes?: KnowledgeSourceType[] | null;
  limit?: number;
}) {
  return JSON.stringify({
    query: params.query,
    category: normalizeSearchText(params.category ?? ""),
    generation: isCarGeneration(params.generation) ? params.generation : null,
    sourceTypes: [...(params.sourceTypes ?? [])].sort(),
    limit: params.limit ?? 8,
  });
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
