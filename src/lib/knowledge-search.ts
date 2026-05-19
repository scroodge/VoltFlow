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
  | "manual"
  | "seed";

const knowledgeSourceTypes = new Set<KnowledgeSourceType>([
  "article",
  "faq",
  "accessory",
  "spare_part",
  "manual",
  "seed",
]);

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
  const query = params.query.trim();

  if (query.length < 2) {
    return [];
  }

  const embedding = await createEmbedding(query);

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
