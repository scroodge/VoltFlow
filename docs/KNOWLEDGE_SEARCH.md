# Knowledge-base smart search

VoltFlow's smart search is semantic retrieval over the knowledge base. It finds
content by meaning rather than requiring an exact keyword match. It does not
generate an AI answer: it returns ranked existing records and the UI decides
whether the result is strong enough to present as an answer.

## Technology

| Layer | Technology |
|---|---|
| Query and indexing embeddings | OpenAI `text-embedding-3-small` |
| Embedding size | 1,536 dimensions |
| Vector storage | Supabase Postgres with `pgvector` in the `extensions` schema |
| Vector index | HNSW with cosine distance |
| Retrieval | PostgreSQL RPC `public.match_knowledge_items` |
| Application API | Next.js `POST /api/knowledge/search` |
| Server credentials | OpenAI key and Supabase service role stay server-side |

The OpenAI model is used only for embeddings. There is no Chat Completions,
Responses API, LLM reranker, or generated summary in the search path.

## Indexing flow

Published and editable knowledge records live in their domain tables:

- articles;
- FAQ items;
- accessories;
- spare parts;
- service providers.

When an admin creates or updates an indexed item, the server builds one text
document containing:

```text
Название: <title>
Категория: <category>
Теги: <tags, when present>
Содержание: <content>
```

That text is sent to OpenAI, and the returned vector is upserted into
`public.knowledge_items` together with the source type, source ID, URL,
publication status, tags, and compatible car generations.

For service providers, the indexed content includes the description, address,
city/service area, offered services, starting price, and compatible generation.
The service chips are searchable metadata; they do not need to be shown as
public UI tags.

## Query flow

1. A user types at least two characters into a search box.
2. The client waits 350 ms after the last keystroke and aborts the previous
   request if a newer query arrives.
3. `POST /api/knowledge/search` validates the query, generation, source types,
   and result limit.
4. The server embeds the query with the same OpenAI model.
5. It calls `match_knowledge_items` with the query vector.
6. Postgres keeps only published rows with vectors, applies optional category,
   generation, and source-type filters, and removes results below similarity
   `0.2`.
7. Results are ordered by vector distance and limited to at most 20 rows. The
   UI normally requests 6–8 rows.
8. The result renderer links to the appropriate article, catalog item, service,
   or external URL.

## Confidence and refusal behavior

Retrieval and presentation confidence are separate. A result can be returned
by Postgres but still be too weak to present as an answer.

The UI treats the set as confident when either:

- the top similarity is at least `0.45`; or
- the top result leads the second result by at least `0.06`.

Otherwise the UI says that it did not find an exact answer and labels the cards
as possible related material. These constants are mirrored in
`scripts/knowledge-search-eval.mjs`.

This matters for content gaps. A weak match such as a winter accessory should
not be presented as an answer to a question about winter charging when the
knowledge base has no article about that topic.

## Search scope by UI

| Surface | Source types |
|---|---|
| Main knowledge-base search | articles, FAQ, accessories, spare parts |
| Accessories tab | accessories |
| Spare-parts tab | spare parts |
| Service tab | service providers |

Generation filters are passed into the vector RPC, so a `gen1_2024` query does
not retrieve content explicitly limited to another generation.

## Usage and cost

The repository currently does not store OpenAI token usage per request, so a
true production average cannot be derived from this codebase yet. The official
model price is currently **$0.02 per 1 million input tokens** for
`text-embedding-3-small`; embeddings have no output-token charge in this flow.

The practical usage pattern is:

- one embedding request per search query after debounce;
- one embedding request per indexed create/update;
- no embedding request while a user is merely browsing cards;
- repeated identical searches are cached server-side for five minutes;
- re-saving an unchanged item currently regenerates its embedding.

Approximate standard-price examples:

| Workload | Assumed input | Approximate cost |
|---|---:|---:|
| 1,000 user searches | 10 tokens/query | $0.0002 |
| 1,000 indexed records | 300 tokens/record | $0.006 |
| 100,000 user searches | 10 tokens/query | $0.02 |

These are estimates, not measured averages. Token counts should be measured
with a tokenizer or the OpenAI usage endpoint. The organization embeddings
usage endpoint reports `input_tokens` and `num_model_requests` by time bucket
and model.

Official references:

- [text-embedding-3-small model and pricing](https://developers.openai.com/api/docs/models/text-embedding-3-small)
- [OpenAI embeddings FAQ](https://help.openai.com/en/articles/6824809-embeddings-faq)
- [Embeddings usage API](https://platform.openai.com/docs/api-reference/usage/embeddings)

## Failure modes and safeguards

- Missing `OPENAI_API_KEY` prevents embedding creation and indexing/search.
- A failed search returns a generic production error; development responses
  include diagnostic details.
- The RPC must keep `search_path = public, extensions`; otherwise self-hosted
  Postgres cannot resolve the `pgvector` cosine operator.
- Unpublished records and records without an embedding are excluded.
- A static Telegram knowledge fallback keeps the public UI usable when the
  database read fails, but static fallback records are not automatically
  searchable through the vector RPC until they are indexed.

## Owner files

- Embedding creation and text construction: `src/lib/embeddings.ts`
- Retrieval and cache: `src/lib/knowledge-search.ts`
- HTTP validation: `src/app/api/knowledge/search/route.ts`
- Client debounce and request cancellation: `src/hooks/use-semantic-knowledge-search.ts`
- Confidence presentation: `src/lib/knowledge-search-confidence.ts`
- Result links and rendering: `src/components/telegram/SemanticSearchResults.tsx`
- Database table and RPC migrations: `supabase/migrations/20260518120000_semantic_search.sql`
  and subsequent search migrations
- Evaluation: `scripts/knowledge-search-eval.mjs`
