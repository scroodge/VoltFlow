-- Article view counter for the public knowledge base.
--
-- Kept in its OWN table rather than as a `view_count` column on knowledge_articles on
-- purpose: that table has a BEFORE UPDATE trigger (set_knowledge_articles_updated_at,
-- migration 20260516120000) which stamps updated_at = now(). Incrementing a column there
-- would bump updated_at on every page view and silently turn the "recently updated"
-- article list into "most recently viewed".
--
-- The KB is public (anon can SELECT published articles). RLS cannot restrict *which
-- column* an UPDATE touches, so granting anon write access to knowledge_articles would let
-- anyone rewrite article bodies. Instead this table has NO insert/update policy at all --
-- the only write path is the SECURITY DEFINER function below, which can only ever
-- increment a counter.

create table if not exists public.knowledge_article_views (
  article_id uuid primary key
    references public.knowledge_articles(id) on delete cascade,
  view_count bigint not null default 0,
  last_viewed_at timestamptz not null default now(),
  constraint knowledge_article_views_count_non_negative check (view_count >= 0)
);

alter table public.knowledge_article_views enable row level security;

-- Supabase's default grants hand ALL privileges on public tables to anon/authenticated.
-- RLS (below, with no write policy) already denies writes, but leaving the GRANT in place
-- would mean the whole thing rests on that single policy existing. Take the privilege away
-- as well, so reads are the only thing the client role is even permitted to attempt.
revoke all on public.knowledge_article_views from anon, authenticated;
grant select on public.knowledge_article_views to anon, authenticated;

drop policy if exists "Everyone can read article view counts"
  on public.knowledge_article_views;
create policy "Everyone can read article view counts"
on public.knowledge_article_views for select
to anon, authenticated
using (true);

-- No insert/update/delete policy is defined. RLS is enabled, so direct writes from anon or
-- authenticated are denied; only the definer function below can write.

create or replace function public.increment_knowledge_article_view(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_article_id uuid;
begin
  -- Resolve by slug and require published: an unknown or unpublished slug is a no-op
  -- rather than an error, so a stale link cannot be used to probe the table.
  select id
    into v_article_id
    from public.knowledge_articles
   where slug = p_slug
     and status = 'published';

  if v_article_id is null then
    return;
  end if;

  insert into public.knowledge_article_views as v (article_id, view_count, last_viewed_at)
  values (v_article_id, 1, now())
  on conflict (article_id) do update
     set view_count = v.view_count + 1,
         last_viewed_at = now();
end;
$$;

revoke all on function public.increment_knowledge_article_view(text) from public;
grant execute on function public.increment_knowledge_article_view(text)
  to anon, authenticated;
