"use client";

import { useCallback, useRef, useState } from "react";

import type { CarGeneration } from "@/lib/car-generations";
import type {
  KnowledgeSearchResult,
  KnowledgeSourceType,
} from "@/lib/knowledge-search";

export function useSemanticKnowledgeSearch({
  category,
  generation,
  limit = 6,
  sourceTypes,
}: {
  category?: string | null;
  generation: CarGeneration;
  limit?: number;
  sourceTypes?: KnowledgeSourceType[];
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sourceTypesKey = sourceTypes?.join("|") ?? "";

  const search = useCallback(async (nextQuery: string) => {
    setQuery(nextQuery);
    const trimmedQuery = nextQuery.trim();
    abortRef.current?.abort();

    if (trimmedQuery.length < 2) {
      setResults([]);
      setIsSearching(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsSearching(true);
    setError(null);

    try {
      const response = await fetch("/api/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmedQuery,
          category: category || undefined,
          generation,
          sourceTypes: sourceTypesKey ? sourceTypesKey.split("|") : undefined,
          limit,
        }),
        signal: controller.signal,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error ?? "Search failed.");
      }

      setResults(Array.isArray(payload.results) ? payload.results : []);
    } catch (searchError) {
      if (controller.signal.aborted) return;
      console.error("Telegram semantic search error:", searchError);
      setResults([]);
      setError("Не удалось выполнить умный поиск. Попробуйте позже.");
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  }, [category, generation, limit, sourceTypesKey]);

  return {
    error,
    isSearching,
    query,
    results,
    search,
    trimmedQuery: query.trim(),
  };
}
