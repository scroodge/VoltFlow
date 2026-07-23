import { NextRequest, NextResponse } from "next/server";

import { buildKnowledgeEmbeddingText, createEmbedding } from "@/lib/embeddings";
import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";
import { invalidateKnowledgeSearchCache } from "@/lib/knowledge-search";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/knowledge";

type KnowledgeItemForReindex = {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[] | null;
};

type ReindexFailure = {
  id: string;
  title: string;
  error: string;
};

type ReindexResult = {
  ok: true;
  id: string;
} | {
  ok: false;
  failure: ReindexFailure;
};

const DEFAULT_REINDEX_CONCURRENCY = 4;
const MAX_REINDEX_CONCURRENCY = 5;

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const force = body?.force === true;
    const concurrency = clampConcurrency(body?.concurrency);

    let query = supabaseAdmin
      .from("knowledge_items")
      .select("id,title,content,category,tags")
      .eq("is_published", true)
      .order("updated_at", { ascending: true });

    if (!force) {
      query = query.is("embedding", null);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    const items = (data ?? []) as KnowledgeItemForReindex[];
    const results = await mapWithConcurrency(items, concurrency, (item) =>
      reindexKnowledgeItem(item),
    );
    const failures = results.flatMap((result) => result.ok ? [] : [result.failure]);
    const count = results.length - failures.length;
    if (count > 0) {
      invalidateKnowledgeSearchCache();
    }

    return NextResponse.json(
      {
        count,
        failed: failures,
        failureCount: failures.length,
        total: items.length,
        force,
        concurrency,
      },
      { status: failures.length > 0 ? 207 : 200 },
    );
  } catch (error) {
    console.error("Knowledge reindex error:", error);
    return NextResponse.json({ error: "Knowledge reindex failed." }, { status: 500 });
  }
}

async function reindexKnowledgeItem(item: KnowledgeItemForReindex): Promise<ReindexResult> {
  try {
    const embeddingText = buildKnowledgeEmbeddingText({
      title: item.title,
      content: item.content,
      category: item.category,
      tags: item.tags ?? [],
    });
    const embedding = await createEmbedding(embeddingText);
    const { error: updateError } = await supabaseAdmin
      .from("knowledge_items")
      .update({ embedding })
      .eq("id", item.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return { ok: true, id: item.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown reindex error.";
    console.error(`Knowledge reindex item failed (${item.id}):`, error);

    return {
      ok: false,
      failure: {
        id: item.id,
        title: item.title,
        error: message,
      },
    };
  }
}

function clampConcurrency(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_REINDEX_CONCURRENCY;
  }

  return Math.max(1, Math.min(MAX_REINDEX_CONCURRENCY, Math.floor(value)));
}
