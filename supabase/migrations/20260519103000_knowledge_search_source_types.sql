drop function if exists public.match_knowledge_items(
  extensions.vector(1536),
  float,
  int,
  text,
  text
);

create or replace function public.match_knowledge_items(
  query_embedding extensions.vector(1536),
  match_threshold float default 0.2,
  match_count int default 8,
  filter_category text default null,
  filter_generation text default null,
  filter_source_types text[] default null
)
returns table (
  id uuid,
  title text,
  content text,
  category text,
  source_type text,
  source_url text,
  telegram_message_id text,
  tags text[],
  similarity float
)
language sql
stable
as $$
  select
    knowledge_items.id,
    knowledge_items.title,
    knowledge_items.content,
    knowledge_items.category,
    knowledge_items.source_type,
    knowledge_items.source_url,
    knowledge_items.telegram_message_id,
    knowledge_items.tags,
    1 - (knowledge_items.embedding <=> query_embedding) as similarity
  from public.knowledge_items
  where
    knowledge_items.is_published = true
    and knowledge_items.embedding is not null
    and (filter_category is null or knowledge_items.category = filter_category)
    and (filter_generation is null or knowledge_items.model_generations @> array[filter_generation]::text[])
    and (filter_source_types is null or knowledge_items.source_type = any(filter_source_types))
    and 1 - (knowledge_items.embedding <=> query_embedding) > match_threshold
  order by knowledge_items.embedding <=> query_embedding asc
  limit least(match_count, 20);
$$;
